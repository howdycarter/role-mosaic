import {seedQuality} from './helpers/quality-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {ApplicationStore,digest,prepareApplications,runApplications,postingKey,salaryForLocation,fillPlan,dayAt,configureStandingAuthorization,answerFor} from '../src/applications.js';
const now=()=>new Date('2026-11-09T18:00:00Z');
test('native callers cannot bypass quality with the legacy compatibility flag',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.transport='playwright';const p=await f.store.read('application-policy.json');await f.store.write('application-policy.json',{...p,requireQualityReview:false});await f.store.write('career-evidence.json',{sources:[],facts:[],caseStudies:[]});assert.equal((await f.run())[0].status,'quality_held');assert.deepEqual(f.events,[]);}finally{await f.close();}
});
test('manual mode blocks direct engine submission even with an approved packet',async()=>{
 const f=await fixture();try{await f.authorize();const p=await f.store.read('application-policy.json');await f.store.write('application-policy.json',{...p,submissionMode:'manual'});assert.equal((await f.run())[0].status,'review_only');assert.deepEqual(f.events,[]);assert.deepEqual(await f.store.read('application-ledger.json',[]),[]);}finally{await f.close();}
});
test('native automatic execution needs risk acknowledgement and source-backed quality review',async()=>{
 const f=await fixture();try{f.adapter.transport='playwright';await f.authorize();let p=await f.store.read('application-policy.json');await f.store.write('application-policy.json',{...p,submissionMode:'automatic',automationRiskAcknowledged:false});assert.equal((await f.run())[0].status,'automation_risk_unacknowledged');assert.deepEqual(f.events,[]);p=await f.store.read('application-policy.json');await f.store.write('career-evidence.json',{sources:[],facts:[],caseStudies:[]});await f.store.write('application-policy.json',{...p,automationRiskAcknowledged:true,requireQualityReview:true});assert.equal((await f.run())[0].status,'quality_held');assert.deepEqual(f.events,[]);}finally{await f.close();}
});
test('automatic quality gates pin evidence and the selected track PDF through final submission',async()=>{
 const {loadEvidence,jobDigest}=await import('../src/quality.js'),{registerTrackResume}=await import('../src/packets.js');
 for(const mutation of ['none','source-before','source-during','wrong-track']){const f=await fixture();try{
  f.adapter.transport='playwright';const text='Owned product roadmaps and delivery.';await writeFile(path.join(f.root,'evidence.txt'),text);await f.store.write('career-evidence.json',{sources:[{id:'s',path:'evidence.txt',sha256:digest(text)}],facts:[{id:'f',text,quote:text,sourceId:'s',verified:true,tracks:['product'],capabilities:[]}],caseStudies:[{id:'case',tracks:['product'],evidenceIds:['f'],url:'https://example.invalid/case'}]});
  await f.store.write('resume-registry.json',{variants:{}});await registerTrackResume({home:f.root,track:mutation==='wrong-track'?'design':'product',file:path.join(f.root,'resume.pdf'),confirm:'reviewed'});const e=await loadEvidence(f.root);await f.store.write('quality-reviews.json',{[f.job.id]:{jobDigest:jobDigest(f.job),evidenceDigest:e.digest,resumeSha256:digest(await readFile(path.join(f.root,'resume.pdf'))),allMandatoryReviewed:true,reviewer:'Synthetic applicant review',reviewedAt:new Date().toISOString(),requirements:[{text:'Product ownership',status:'supported',evidenceIds:['f']}]}});
  const p=await f.store.read('application-policy.json');await f.store.write('application-policy.json',{...p,requireQualityReview:true});
  if(mutation==='wrong-track'){assert.equal((await f.prepare()).packets.length,0);assert.deepEqual(f.events,[]);continue;}
  await f.authorize();if(mutation==='source-before')await writeFile(path.join(f.root,'evidence.txt'),'Changed');
  if(mutation==='source-during'){const fill=f.adapter.fill;f.adapter.fill=async(...a)=>{await fill(...a);await writeFile(path.join(f.root,'evidence.txt'),'Changed');};}
  const result=await f.run();assert.equal(result[0].status,mutation==='none'?'submitted':mutation==='source-before'?'quality_held':'held');assert.equal(f.events.includes('submit'),mutation==='none');
 }finally{await f.close();}}
});
test('explicit uncertain-restart exception preserves the original and permits only one fresh native attempt',async()=>{
 const {authorizeUnknownRestart}=await import('../src/applications.js');assert.equal(typeof authorizeUnknownRestart,'function');
 const f=await fixture();try{
  f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Applicant automatic application authorization',now});
  const original={id:'original-unknown',jobId:f.job.id,postingKey:postingKey(f.job.url),url:f.job.url,status:'submission_unknown',day:'2026-11-09',resumeSha256:digest(await readFile(path.join(f.root,'resume.pdf')))};
  await f.store.write('application-ledger.json',[original]);assert.equal((await f.prepare()).packets.length,0);
  const grant=await authorizeUnknownRestart({home:f.root,attemptId:original.id,evidence:'Applicant explicitly authorizes one restart despite possible duplicate',confirm:'one-restart-despite-duplicate-risk',now});
  const plan=await prepareApplications({home:f.root,adapter:f.adapter,jobIds:[f.job.id],restartAuthorizationId:grant.id,now});assert.equal(plan.packets.length,1);
  f.adapter.submit=async()=>f.events.push('submit');const r=await f.run();assert.equal(r[0].status,'submitted');
  const ledger=await f.store.read('application-ledger.json');assert.deepEqual(ledger[0],original);assert.equal(ledger[1].restartsAttemptId,original.id);
  const {reconcileApplications}=await import('../src/applications.js');f.adapter.recoverReceipt=async()=>({confirmed:true,posting:f.job.url,text:'Application received'});await reconcileApplications({home:f.root,adapter:f.adapter,now});assert.equal((await f.store.read('application-ledger.json'))[0].status,'submission_unknown');assert.equal((await f.store.read('history.json')).length,1);
  assert.equal((await f.run())[0].status,'restart_authorization_held');assert.deepEqual(f.events,['fill','submit']);
  await assert.rejects(authorizeUnknownRestart({home:f.root,attemptId:original.id,evidence:'Again',confirm:'one-restart-despite-duplicate-risk',now}));
 }finally{await f.close();}
});
test('uncertain-restart exception cannot ignore a new receipt, changed scope, or the original quota reservation',async()=>{
 const {authorizeUnknownRestart}=await import('../src/applications.js');assert.equal(typeof authorizeUnknownRestart,'function');
 for(const change of ['receipt','scope','quota']){const f=await fixture();try{
  f.adapter.transport='playwright';let policy=await f.store.read('application-policy.json');if(change==='quota')await f.store.write('application-policy.json',{...policy,maxPerDay:1});
  await configureStandingAuthorization({home:f.root,evidence:'Applicant automatic application authorization',now});
  await f.store.write('application-ledger.json',[{id:'original',jobId:f.job.id,postingKey:postingKey(f.job.url),url:f.job.url,status:'submission_unknown',day:'2026-11-09',resumeSha256:digest(await readFile(path.join(f.root,'resume.pdf')))}]);
  const grant=await authorizeUnknownRestart({home:f.root,attemptId:'original',evidence:'Applicant explicitly authorizes one restart despite possible duplicate',confirm:'one-restart-despite-duplicate-risk',now});
  const plan=await prepareApplications({home:f.root,adapter:f.adapter,jobIds:[f.job.id],restartAuthorizationId:grant.id,now});assert.equal(plan.packets.length,1);
  if(change==='receipt'){const a=await f.store.read('application-ledger.json');a[0].status='submitted';await f.store.write('application-ledger.json',a);}
  if(change==='scope'){policy=await f.store.read('application-policy.json');await f.store.write('application-policy.json',{...policy,maxPerDay:14});}
  assert.equal((await f.run())[0].status,change==='quota'?'daily_limit':'restart_authorization_held');assert.deepEqual(f.events,[]);
 }finally{await f.close();}}
});
test('a held recovery continues the same pre-submit attempt without authorizing a second restart',async()=>{
 const {authorizeUnknownRestart}=await import('../src/applications.js');const f=await fixture();try{
 f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Explicit automatic search authorization',now});await f.store.write('application-ledger.json',[{id:'original',jobId:f.job.id,url:f.job.url,postingKey:postingKey(f.job.url),status:'submission_unknown',day:'2026-11-09',resumeSha256:digest(await readFile(path.join(f.root,'resume.pdf')))}]);
 const grant=await authorizeUnknownRestart({home:f.root,attemptId:'original',evidence:'Explicit one-restart duplicate-risk exception',confirm:'one-restart-despite-duplicate-risk',now});await prepareApplications({home:f.root,adapter:f.adapter,jobIds:[f.job.id],restartAuthorizationId:grant.id,now});
 f.adapter.verify=async()=>({ok:false,reason:'Widget needs repair'});const held=(await f.run())[0];assert.equal(held.status,'held');
 f.adapter.verify=async()=>({ok:true});f.adapter.submit=async()=>f.events.push('submit');const r=await runApplications({home:f.root,adapter:f.adapter,resumeAttemptId:held.id,now});assert.equal(r[0].status,'submitted');assert.equal(r[0].id,held.id);assert.equal((await f.store.read('application-ledger.json')).length,2);
 }finally{await f.close();}
});
test('compound authorization without sponsorship is affirmative for an authorized non-sponsored US applicant',()=>{const p={facts:{authorizedUS:true,requiresSponsorshipUS:false}};assert.equal(answerFor({label:'Are you legally authorized to work in the United States without requiring sponsorship now or in the future?'},p),'Yes');assert.equal(answerFor({label:'Will you require visa sponsorship?',countryContext:'US'},p),'No');assert.equal(answerFor({label:'Will you require visa sponsorship in Canada?',countryContext:'US'},p),undefined);assert.equal(answerFor({label:'If you require sponsorship now or in the future, please provide more detail.',countryContext:'US'},p),undefined);});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-auto-')),store=new ApplicationStore(root),resume=path.join(root,'resume.pdf');
 const pdf=Buffer.from('%PDF-1.4\nsynthetic');await writeFile(resume,pdf);
 const profile={verified:true,facts:{firstName:'Example',lastName:'Person',fullName:'Example Person',email:'person@example.invalid',stateCode:'TX',authorizedUS:true,requiresSponsorshipUS:false}};
 const job={id:'example-id',company:'Example',title:'Director of Product',location:'Remote US',url:'https://job-boards.greenhouse.io/example/jobs/123',status:'new',compensation:{min:200000,currency:'USD',interval:'year'}};
 await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],remoteCountry:'United States',minAnnualBaseUsd:190000,excludeEmployers:[]});
 await store.write('connections.json',{resume});await store.write('application-profile.json',profile);
 const approval=path.join(root,'resume-approval.json');await writeFile(approval,JSON.stringify({approved:true,path:resume,sha256:digest(pdf)}));
 await store.write('application-policy.json',{enabled:true,submissionMode:'automatic',automationRiskAcknowledged:true,requireQualityReview:false,maxPerDay:15,dailyBudgetUsd:1,timezone:'America/Chicago',resumeApprovalPath:approval,verifiedProfileSha256:digest(profile)});
 await store.write('jobs.json',[job]);await store.write('history.json',[]);await seedQuality(root,job,resume);
 const form={fields:[{id:'first',label:'First Name',type:'text',required:true,value:''},{id:'email',label:'Email',type:'text',required:true,value:''}],resume:{id:'resume',label:'Resume'},submit:{label:'Submit application'}};
 const events=[];
 const adapter={estimatedCostUsd:0,inspect:async(j)=>({job:j,tabId:'fixture-tab',titleVerified:true,closed:false,login:false,location:'Remote, United States',description:'Annual base salary $200,000 - $250,000 USD per year',form:structuredClone(form)}),fill:async()=>events.push('fill'),verify:async()=>({ok:true}),submit:async()=>{assert.equal((await store.read('application-ledger.json',[]))[0].status,'submission_unknown');events.push('submit')},confirm:async()=>({confirmed:true,posting:job.url,text:'Your application has been received'})};
 const prepare=()=>prepareApplications({home:root,adapter,now});
 const authorize=async()=>{const plan=await prepare();assert.equal(plan.packets.length,1);await store.write('application-approvals.json',plan.packets.map(p=>({approved:true,packetDigest:p.digest,resumeSha256:p.resumeSha256,profileSha256:p.profileSha256,searchSha256:p.searchSha256,expiresAt:p.expiresAt})));return plan;};
 return {root,store,adapter,job,form,events,profile,prepare,authorize,run:()=>runApplications({home:root,adapter,now}),close:()=>rm(root,{recursive:true,force:true})};
}
test('regional pay chooses Texas/all-other-states, rejects ambiguous currency and below-floor data',()=>{
 const text='USA base pay range (CA, WA, NY, NJ, CT) per year: $255,000 - $335,000 USA base pay range (all other U.S. states) per year: $226,000 - $306,000';
 assert.equal(salaryForLocation(text,'TX').min,226000);assert.equal(salaryForLocation(text,'CA').min,255000);
 assert.equal(salaryForLocation(text,''),null);assert.equal(salaryForLocation('Annual base salary $200,000 - $250,000 CAD','TX'),null);
 assert.equal(dayAt(new Date('2026-11-10T01:00:00Z'),'America/Chicago'),'2026-11-09');
 assert.equal(postingKey('https://boards.greenhouse.io/example/jobs/123?gh_jid=123'),postingKey('https://job-boards.greenhouse.io/example/jobs/123'));
});
test('explicit US full-time base salary is recognized without requiring the word annual',()=>{
 const pay=salaryForLocation('The US base salary range for this full-time position is $240,000-$310,000 USD.','TX');
 assert.equal(pay?.min,240000);assert.equal(pay?.max,310000);
 assert.equal(salaryForLocation('The US total compensation range for this full-time position is $240,000-$310,000 USD.','TX'),null);
 assert.equal(salaryForLocation('The base salary range for this full-time position is $240,000-$310,000 CAD.','TX'),null);
});
test('plan is read-only; only explicit packet authorization enables fill and submit, with durable receipt state',async()=>{
 const f=await fixture();try{
  const plan=await f.prepare();assert.equal(plan.packets.length,1);assert.deepEqual(f.events,[]);
  assert.equal((await f.run())[0].status,'authorization_required');assert.deepEqual(f.events,[]);
  await f.authorize();const results=await f.run();assert.equal(results[0].status,'submitted');assert.deepEqual(f.events,['fill','submit']);
  assert.equal((await f.store.read('history.json',[]))[0].receiptId,results[0].id);
  assert.equal((await f.store.read('jobs.json',[]))[0].receiptId,results[0].id);
  assert.equal((await f.run())[0].status,'duplicate_held');assert.deepEqual(f.events,['fill','submit']);
 }finally{await f.close();}
});
test('standing search authorization submits natively without inventing per-job approval and cannot authorize the Codex adapter',async()=>{
 const f=await fixture();try{await f.prepare();await configureStandingAuthorization({home:f.root,evidence:'Applicant explicitly enabled automatic matching applications',now});
 assert.equal((await f.run())[0].status,'authorization_required');f.adapter.transport='playwright';await f.prepare();
 const result=await f.run();assert.equal(result[0].status,'submitted');assert.equal(result[0].authorization.mode,'search-rules');assert.deepEqual(await f.store.read('application-approvals.json',[]),[]);
 }finally{await f.close();}
});
test('standing scope changes and revocation during fill stop submission',async()=>{
 for(const change of ['revoke','budget']){const f=await fixture();try{f.adapter.transport='playwright';await f.prepare();await configureStandingAuthorization({home:f.root,evidence:'Explicit synthetic applicant authorization',now});
 const fill=f.adapter.fill;f.adapter.fill=async(...args)=>{await fill(...args);const p=await f.store.read('application-policy.json');if(change==='revoke')p.standingAuthorization.enabled=false;else p.dailyBudgetUsd=2;await f.store.write('application-policy.json',p)};
 assert.equal((await f.run())[0].status,'held');assert.deepEqual(f.events,['fill']);
 }finally{await f.close();}}
});
test('a native worker prepares and submits in the same cycle under standing rules',async()=>{
 const f=await fixture();try{f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Explicit automatic search authorization',now});const {MosaicWorker}=await import('../src/worker.js');const w=new MosaicWorker({home:f.root,adapterFactory:async()=>f.adapter});await w.cycle({discover:false});assert.equal((await f.store.read('application-ledger.json'))[0].status,'submitted');assert.deepEqual(await f.store.read('application-approvals.json',[]),[]);assert.deepEqual(f.events,['fill','submit']);}finally{await f.close();}
});
test('posting-scoped answers do not leak to another employer or job',()=>{const form={fields:[{label:'Why this company?',type:'text',required:true,value:''}],resume:{label:'Resume'},submit:{label:'Submit'}};const p={facts:{},answers:[{question:'Why this company?',answer:'Company-specific narrative',verified:true,scopePostingKey:'job:A'}]};assert.equal(fillPlan(form,p,{postingKey:'job:A'}).actions[0].value,'Company-specific narrative');assert.equal(fillPlan(form,p,{postingKey:'job:B'}).actions.length,0);assert.equal(fillPlan(form,p,{postingKey:'job:B'}).missing.length,1);});
test('pre-submit holds do not use standing submission quota; uncertain submissions still reserve it',async()=>{
 const f=await fixture();try{f.adapter.transport='playwright';await f.prepare();await configureStandingAuthorization({home:f.root,evidence:'Explicit synthetic applicant authorization',now});
 const day='2026-11-09',held=Array.from({length:15},(_,i)=>({id:'draft-'+i,postingKey:'other:'+i,day,status:'held',reservedCostUsd:0}));await f.store.write('application-ledger.json',held);await f.store.write('history.json',[{company:'Other',role:'Other',date:day,status:'not_submitted_listing_not_available'}]);
 f.adapter.submit=async()=>{assert.equal((await f.store.read('application-ledger.json')).at(-1).status,'submission_unknown');f.events.push('submit')};const result=await f.run();assert.equal(result[0].status,'submitted');
 }finally{await f.close();}
 const f2=await fixture();try{f2.adapter.transport='playwright';await f2.prepare();await configureStandingAuthorization({home:f2.root,evidence:'Explicit synthetic applicant authorization',now});await f2.store.write('application-ledger.json',Array.from({length:15},(_,i)=>({id:'unknown-'+i,postingKey:'other:'+i,day:'2026-11-09',status:'submission_unknown'})));assert.equal((await f2.run())[0].status,'daily_limit');assert.deepEqual(f2.events,[]);}finally{await f2.close();}
});
test('a submit transport failure remains unknown and cannot be automatically retried',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.submit=async()=>{assert.equal((await f.store.read('application-ledger.json',[]))[0].status,'submission_unknown');throw Error('lost browser')};
 assert.equal((await f.run())[0].status,'submission_unknown');assert.equal((await f.run())[0].status,'duplicate_held');assert.deepEqual(f.events,['fill']);assert.deepEqual(await f.store.read('history.json',[]),[]);
 }finally{await f.close();}
});
test('CAPTCHA and failed readback hold without clicking Submit',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.verify=async()=>({ok:false,captcha:true,reason:'Human verification required'});
 assert.equal((await f.run())[0].status,'held');assert.deepEqual(f.events,['fill']);assert.equal((await f.run())[0].status,'duplicate_held');
 }finally{await f.close();}
});
test('a worker pause after fill preserves a held draft without a final submission click',async()=>{
 const f=await fixture();try{await f.authorize();const result=await runApplications({home:f.root,adapter:f.adapter,now,shouldContinue:()=>false});assert.equal(result[0].status,'held');assert.equal(result[0].reason,'Worker paused before submission');assert.deepEqual(f.events,['fill']);assert.deepEqual(await f.store.read('history.json'),[]);}finally{await f.close();}
});
test('daily limits include imported confirmed date-only receipts in the applicant timezone',async()=>{
 const f=await fixture();try{await f.authorize();const policy=await f.store.read('application-policy.json');policy.maxPerDay=1;await f.store.write('application-policy.json',policy);
 await f.store.write('history.json',[{company:'Other',role:'Different',status:'submitted',date:'2026-11-09'}]);
 assert.equal((await f.run())[0].status,'daily_limit');assert.deepEqual(f.events,[]);
 }finally{await f.close();}
});
test('cost estimates exceeding the daily cap cannot transmit applicant data',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.estimatedCostUsd=2;assert.equal((await f.run())[0].status,'budget_limit');assert.deepEqual(f.events,[]);}finally{await f.close();}
});
test('altered resume, verified profile, search and application packet invalidate authorizations',async()=>{
 for(const kind of ['resume','profile','search','packet']){
  const f=await fixture();try{await f.authorize();
   if(kind==='resume')await writeFile(path.join(f.root,'resume.pdf'),'%PDF-1.4\nchanged');
   if(kind==='profile'){const p=await f.store.read('application-profile.json');p.facts.email='changed@example.invalid';await f.store.write('application-profile.json',p);}
   if(kind==='search'){const s=await f.store.read('search.json');s.minAnnualBaseUsd=100000;await f.store.write('search.json',s);}
   if(kind==='packet'){const p=await f.store.read('application-plan.json');p.packets[0].job.title='Altered';await f.store.write('application-plan.json',p);}
   await assert.rejects(f.run());assert.deepEqual(f.events,[]);
  }finally{await f.close();}
 }
});
test('unknown required facts, consents and conflicting existing values are not guessed',()=>{
 const profile={facts:{firstName:'Example'},answers:[]};
 const form={fields:[{label:'First Name',type:'text',required:true,value:'Someone else'},{label:'Years running revenue operations',required:true,type:'text'},{label:'Agree to recruiting texts',required:true,type:'checkbox'}],resume:{label:'Resume'},submit:{label:'Submit application'}};
 const plan=fillPlan(form,profile);assert.equal(plan.actions.length,0);assert.equal(plan.missing.length,3);
});
test('changed form or posting, missing title proof, and unsupported source never cause a fill',async()=>{
 const f=await fixture();try{await f.authorize();const inspect=f.adapter.inspect;f.adapter.inspect=async j=>({...await inspect(j),titleVerified:false});assert.equal((await f.run())[0].status,'posting_or_form_changed');assert.deepEqual(f.events,[]);}finally{await f.close();}
});
test('a receipt for another posting does not create an applied record',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.confirm=async()=>({confirmed:true,posting:'https://job-boards.greenhouse.io/example/jobs/999',text:'Thank you for applying'});assert.equal((await f.run())[0].status,'submission_unknown');assert.deepEqual(await f.store.read('history.json',[]),[]);}finally{await f.close();}
});
test('workspace mutex refuses a concurrent run',async()=>{
 const f=await fixture();try{await f.store.lock(async()=>{await assert.rejects(f.run(),/Another application run/);});assert.deepEqual(f.events,[]);}finally{await f.close();}
});
test('approval revocation during fill prevents the final click',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.fill=async()=>{f.events.push('fill');await f.store.write('application-approvals.json',[])};assert.equal((await f.run())[0].status,'held');assert.deepEqual(f.events,['fill']);}finally{await f.close();}
});

test('receipt-only recovery records delayed employer confirmation without filling or clicking again',async()=>{
 const f=await fixture();try{
  await f.authorize();f.adapter.confirm=async()=>({confirmed:false,posting:f.job.url});
  assert.equal((await f.run())[0].status,'submission_unknown');
  f.adapter.confirm=async()=>({confirmed:true,posting:f.job.url+'/confirmation',text:'We have received your application'});
  const {reconcileApplications}=await import('../src/applications.js');
  const result=await reconcileApplications({home:f.root,adapter:f.adapter,now});
  assert.equal(result[0].status,'submitted');assert.equal((await f.store.read('application-ledger.json',[]))[0].reason,null);assert.deepEqual(f.events,['fill','submit']);
  await reconcileApplications({home:f.root,adapter:f.adapter,now});
  assert.equal((await f.store.read('history.json',[])).length,1);assert.deepEqual(f.events,['fill','submit']);
 }finally{await f.close();}
});
test('explicit held-draft continuation reuses its reservation and never resumes an unknown submission',async()=>{
 const f=await fixture();f.adapter.transport='playwright';try{
  await f.authorize();f.adapter.verify=async()=>({ok:false,reason:'readback needs review'});
  const first=(await f.run())[0];assert.equal(first.status,'held');
  f.adapter.verify=async()=>({ok:true});
  const result=await runApplications({home:f.root,adapter:f.adapter,now,resumeAttemptId:first.id});
  assert.equal(result[0].status,'submitted');assert.equal((await f.store.read('application-ledger.json',[])).length,1);
  assert.deepEqual(await runApplications({home:f.root,adapter:f.adapter,now,resumeAttemptId:first.id}),[]);
 }finally{await f.close();}
});
test('cross-origin receipts with the same posting id never count as submitted',async()=>{
 const f=await fixture();try{await f.authorize();f.adapter.confirm=async()=>({confirmed:true,posting:'https://other.invalid/?gh_jid=123',text:'Thank you for applying'});
 assert.equal((await f.run())[0].status,'submission_unknown');assert.deepEqual(await f.store.read('history.json',[]),[]);
 }finally{await f.close();}
});
test('a tracker-write failure cannot erase a verified receipt or make it retriable',async()=>{
 const f=await fixture();const original=ApplicationStore.prototype.write;let failed=false;
 try{
  await f.authorize();ApplicationStore.prototype.write=async function(name,value){if(name==='history.json'&&value.some(r=>r.receiptId)&&!failed){failed=true;throw Error('simulated disk failure')}return original.call(this,name,value)};
  const result=await f.run();assert.equal(result[0].status,'submitted');assert.equal((await f.store.read('application-ledger.json',[]))[0].status,'submitted');
  ApplicationStore.prototype.write=original;
  const {reconcileApplications}=await import('../src/applications.js');await reconcileApplications({home:f.root,adapter:f.adapter,now});
  assert.equal((await f.store.read('history.json',[])).length,1);assert.deepEqual(f.events,['fill','submit']);
 }finally{ApplicationStore.prototype.write=original;await f.close();}
});
test('the same confirmed submission is counted once across ledger and history',async()=>{
 const f=await fixture();try{
  const second={...f.job,id:'second-id',url:'https://job-boards.greenhouse.io/example/jobs/124',title:'Director of Product Platform'};
  await f.store.write('jobs.json',[f.job,second]);const policy=await f.store.read('application-policy.json');policy.maxPerDay=2;await f.store.write('application-policy.json',policy);
  const plan=await f.prepare();assert.equal(plan.packets.length,2);
  await f.store.write('application-approvals.json',plan.packets.map(p=>({approved:true,packetDigest:p.digest,resumeSha256:p.resumeSha256,profileSha256:p.profileSha256,searchSha256:p.searchSha256,expiresAt:p.expiresAt})));
  let submitted=0;f.adapter.submit=async()=>{submitted++;};f.adapter.confirm=async()=>({confirmed:true,posting:submitted===1?f.job.url:second.url,text:'Your application has been received'});
  const results=await f.run();assert.deepEqual(results.map(r=>r.status),['submitted','submitted']);assert.equal(submitted,2);
 }finally{await f.close();}
});
test('negated employment choices and country dialing labels match only their explicit verified propositions',async()=>{
 const {optionForAnswer,sameAnswer}=await import('../src/application-values.js');
 const employment={label:'Have you previously been employed at Example?*'};
 assert.equal(optionForAnswer(employment,'No',['I have not previously been employed at Example','I have been employed at Example']),'I have not previously been employed at Example');
 assert.equal(sameAnswer(employment,'I have been employed at Example','No'),false);
 assert.equal(sameAnswer({label:'Country*'},'United States +1','United States'),true);
 assert.equal(sameAnswer({label:'Country*'},'Canada +1','United States'),false);
});

test('new applicants must explicitly approve their exact PDF and supply reviewed facts before enabling applications',async()=>{
 const {approveResume,configureApplications}=await import('../src/applications.js');
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-app-setup-')),store=new ApplicationStore(root);
 try{
  const file=path.join(root,'resume.pdf');await writeFile(file,'%PDF-1.4\nfixture');await store.write('connections.json',{resume:file});
  const facts=path.join(root,'facts.json');await writeFile(facts,JSON.stringify({verified:false,facts:{fullName:'Example Person',email:'person@example.invalid'}}));
  await assert.rejects(approveResume({home:root}),/Review/);
  await approveResume({home:root,confirm:'reviewed',now});
  await assert.rejects(configureApplications({home:root,profileFile:facts,confirm:'reviewed'}),/verified/);
  await writeFile(facts,JSON.stringify({verified:true,facts:{fullName:'Example Person',email:'person@example.invalid'}}));
  await configureApplications({home:root,profileFile:facts,confirm:'reviewed',maxPerDay:3,dailyBudgetUsd:0,timezone:'America/Chicago'});
  assert.equal((await store.read('application-policy.json')).maxPerDay,3);
  assert.equal((await store.read('application-policy.json')).dailyBudgetUsd,0);
  await assert.rejects(configureApplications({home:root,profileFile:facts,confirm:'reviewed'}),/already exists/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native held draft refresh after restart retains its attempt and rechecks current rules, while unknowns never reopen',async()=>{
 const f=await fixture();try{
  f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Explicit applicant authorization',now});
  await f.prepare();f.adapter.verify=async()=>({ok:false,reason:'Synthetic unsupported optional control'});
  const [held]=await f.run();assert.equal(held.status,'held');
  const expired=await f.store.read('application-plan.json');expired.packets[0].expiresAt='2020-01-01T00:00:00Z';await f.store.write('application-plan.json',expired);
  f.adapter.verify=async()=>({ok:true});const inspect=f.adapter.inspect;let inspected=0;f.adapter.inspect=async(...args)=>{inspected++;return {...await inspect(...args),tabId:'replacement-tab'}};
  const [submitted]=await runApplications({home:f.root,adapter:f.adapter,now,resumeAttemptId:held.id});
  assert.equal(submitted.id,held.id);assert.equal(submitted.status,'submitted');assert.equal(submitted.draftRefreshes.length,1);assert.equal(submitted.tabId,'replacement-tab');assert.equal((await f.store.read('application-ledger.json')).length,1);
  const ledger=await f.store.read('application-ledger.json');ledger[0].status='submission_unknown';await f.store.write('application-ledger.json',ledger);const count=inspected;
  assert.deepEqual(await runApplications({home:f.root,adapter:f.adapter,now,resumeAttemptId:held.id}),[]);assert.equal(inspected,count);
 }finally{await f.close();}
});
test('native held draft refresh refuses revoked standing authorization before any browser action',async()=>{
 const f=await fixture();try{f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Explicit applicant authorization',now});await f.prepare();f.adapter.verify=async()=>({ok:false});const [held]=await f.run();await configureStandingAuthorization({home:f.root,enabled:false,now});f.adapter.inspect=()=>{throw Error('must not inspect')};assert.equal((await runApplications({home:f.root,adapter:f.adapter,now,resumeAttemptId:held.id}))[0].status,'authorization_required');}finally{await f.close();}
});

test('legal and preferred name aliases use existing facts, while combined authorization does not erase sponsorship conditions',()=>{
 const p={facts:{firstName:'Example',lastName:'Person',preferredName:'Sample',city:'Austin',state:'Texas',stateCode:'TX',country:'United States',authorizedUS:true,requiresSponsorshipUS:false}};
 assert.equal(answerFor({label:'Legal First Name'},p),'Example');assert.equal(answerFor({label:'Legal Last Name'},p),'Person');assert.equal(answerFor({label:'Preferred First & Last Name'},p),'Sample Person');
 const options=['Yes, and I will not require sponsorship now or in the future','Yes, but I will require sponsorship now or in the future to maintain work authorization','No, I am not currently authorized to work in this location'];
 assert.equal(answerFor({label:'Are you legally authorized to work in this location?',countryContext:'US',options},p),options[0]);
 assert.equal(answerFor({label:'Are you legally authorized to work in this location?',countryContext:'Canada',options},p),undefined);
 const field={label:'What location do you intend to work from?',type:'select',required:true};const plan=fillPlan({fields:[field]},p);assert.equal(plan.actions[0].value,'Austin, Texas, United States');assert.equal(field.locationKnown.stateCode,'TX');
});

test('complete verified employment history supports named prior-employer checks but never acquired-company or future-terms assumptions',()=>{
 const p={facts:{employmentHistoryComplete:true,employmentHistoryEmployers:['Example'],employmentRestrictions:false},applyingCompany:'Other'};
 assert.equal(answerFor({label:'Have you ever been employed by Other?'},p),'No');
 assert.equal(answerFor({label:'Have you ever worked at Other or an acquired company?'},p),undefined);
 assert.equal(answerFor({label:'Have you ever been employed by Example?'},{...p,applyingCompany:'Example'}),'Yes');
 assert.equal(answerFor({label:'Have you ever been employed by Other?'},{...p,facts:{...p.facts,employmentHistoryComplete:false}}),undefined);
 assert.equal(answerFor({label:'Are you subject to any agreements with current or former employers that restrict taking a role?'},p),'No');
 assert.equal(answerFor({label:'Will you agree to our employment agreement?'},p),undefined);
});

test('a scoped substantive IC review enables only its unchanged role and applicant scope in the native worker',async()=>{
 const f=await fixture(),reviewNow=()=>new Date(),prepare=()=>prepareApplications({home:f.root,adapter:f.adapter,now:reviewNow});try{const job={...f.job,title:'Staff Product Designer',description:'Complex enterprise workflow design'};await f.store.write('jobs.json',[job]);await seedQuality(f.root,job,path.join(f.root,'resume.pdf'));const search=await f.store.read('search.json');await f.store.write('search.json',{...search,titleLevels:['staff'],titleFields:['product']});f.adapter.transport='playwright';await configureStandingAuthorization({home:f.root,evidence:'Applicant selected staff design and native automatic submissions',now:reviewNow});assert.equal((await prepare()).packets.length,0);
 let policy=await f.store.read('application-policy.json'),g=policy.standingAuthorization;policy.individualContributorReviews=[{jobId:job.id,postingKey:postingKey(job.url),jobSha256:digest({title:job.title,location:job.location,description:job.description}),resumeSha256:g.resumeSha256,profileSha256:g.profileSha256,searchSha256:g.searchSha256,reviewedAt:reviewNow().toISOString(),evidence:'Reviewed enterprise design qualifications against verified applicant history; no specialist engineering qualification inferred.'}];await f.store.write('application-policy.json',policy);
 assert.equal((await prepare()).packets.length,1);await f.store.write('jobs.json',[{...job,description:'Changed specialist requirements'}]);assert.equal((await prepare()).packets.length,0);await f.store.write('jobs.json',[job]);const {MosaicWorker}=await import('../src/worker.js');await new MosaicWorker({home:f.root,adapterFactory:async()=>f.adapter}).cycle({discover:false});assert.deepEqual(f.events,['fill','submit']);
 }finally{await f.close();}
});
