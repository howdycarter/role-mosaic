import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {ApplicationStore,digest,prepareApplications,runApplications,postingKey,salaryForLocation,fillPlan,dayAt} from '../src/applications.js';
const now=()=>new Date('2026-11-09T18:00:00Z');
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-auto-')),store=new ApplicationStore(root),resume=path.join(root,'resume.pdf');
 const pdf=Buffer.from('%PDF-1.4\nsynthetic');await writeFile(resume,pdf);
 const profile={verified:true,facts:{firstName:'Example',lastName:'Person',fullName:'Example Person',email:'person@example.invalid',stateCode:'TX',authorizedUS:true,requiresSponsorshipUS:false}};
 const job={id:'example-id',company:'Example',title:'Director of Product',location:'Remote US',url:'https://job-boards.greenhouse.io/example/jobs/123',status:'new',compensation:{min:200000,currency:'USD',interval:'year'}};
 await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],remoteCountry:'United States',minAnnualBaseUsd:190000,excludeEmployers:[]});
 await store.write('connections.json',{resume});await store.write('application-profile.json',profile);
 const approval=path.join(root,'resume-approval.json');await writeFile(approval,JSON.stringify({approved:true,path:resume,sha256:digest(pdf)}));
 await store.write('application-policy.json',{enabled:true,maxPerDay:15,dailyBudgetUsd:1,timezone:'America/Chicago',resumeApprovalPath:approval,verifiedProfileSha256:digest(profile)});
 await store.write('jobs.json',[job]);await store.write('history.json',[]);
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
 const f=await fixture();try{
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
