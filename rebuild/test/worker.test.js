import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ApplicationStore,digest,approvePackets,configureStandingAuthorization} from '../src/applications.js';import {MosaicWorker} from '../src/worker.js';import {prepareQualityPackets} from '../src/packets.js';
test('default manual preparation never launches a browser or creates application attempts',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-manual-')),s=new ApplicationStore(home);let launches=0;
 try{await s.write('jobs.json',[]);const worker=new MosaicWorker({home,adapterFactory:async()=>{launches++;throw Error('No browser should launch')}});const result=await worker.cycle({discover:false});assert.equal(result.submissionMode,'manual');assert.equal(launches,0);assert.deepEqual(await s.read('application-ledger.json',[]),[]);assert.equal((await s.read('quality-packets.json')).submissionMode,'manual');}finally{await rm(home,{recursive:true,force:true})}
});
test('independent worker preserves waiting packets, submits only approved packets and honors pause',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-worker-')),s=new ApplicationStore(home),resume=path.join(home,'own.pdf'),pdf=Buffer.from('%PDF-1.4\nfixture');await writeFile(resume,pdf);
 const profile={verified:true,facts:{fullName:'Example Person',email:'person@example.invalid',stateCode:'TX'}};
 const url='https://job-boards.greenhouse.io/example/jobs/123',job={id:'job',company:'Example',title:'Director of Product',location:'Remote US',url};let fills=0,submits=0,inspections=0;
 try{
  await s.write('application-profile.json',profile);await s.write('resume-approval.json',{approved:true,path:resume,sha256:digest(pdf)});await s.write('connections.json',{resume,boards:[]});await s.write('history.json',[]);await s.write('jobs.json',[{...job,id:'unsupported',url:'https://example.invalid/jobs/111'},{...job,id:'onsite',url:'https://job-boards.greenhouse.io/example/jobs/222',location:'San Francisco'},job]);await s.write('worker.json',{maxInspections:1});
  await s.write('application-policy.json',{enabled:true,submissionMode:'automatic',automationRiskAcknowledged:true,requireQualityReview:false,maxPerDay:15,dailyBudgetUsd:1,timezone:'America/Chicago',resumeApprovalPath:'resume-approval.json',verifiedProfileSha256:digest(profile)});
  await s.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:190000,excludeEmployers:[]});
  const adapter={estimatedCostUsd:0,inspect:async job=>{inspections++;return {job,tabId:'fixture',titleVerified:true,description:'Annual base salary $200,000 - $250,000 USD per year',location:'Remote US',form:{fields:[{id:'name',label:'Name',type:'text',required:true,value:''}],resume:{label:'Resume'},submit:{label:'Submit application'}}}},fill:async()=>{fills++},verify:async()=>({ok:true}),submit:async()=>{submits++},confirm:async()=>({confirmed:true,posting:url,text:'Thank you for applying'})};
  const worker=new MosaicWorker({home,adapterFactory:async()=>adapter});
  await worker.cycle({discover:false});const original=await s.read('application-plan.json');assert.equal(original.packets.length,1);assert.equal(original.packets[0].job.id,'job');assert.equal(fills,0);
  await worker.cycle({discover:false});
  const expanded=await s.read('application-plan.json');
  assert.deepEqual(expanded.packets.find(packet=>packet.id===original.packets[0].id),original.packets[0]);
  assert.equal(expanded.packets.length,2);assert.equal(inspections,2);assert.equal(submits,0);
  await approvePackets({home,ids:original.packets.map(p=>p.id)});await worker.cycle({discover:false,prepare:false});assert.equal(submits,1);assert.equal(fills,1);
  await worker.cycle({discover:false,prepare:false});assert.equal(submits,1);assert.equal((await s.read('history.json')).length,1);
  await worker.pause();await worker.cycle({discover:false});assert.equal(submits,1);assert.equal(worker.status.state,'paused');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('a second worker cannot enter a workspace already owned by a live cycle',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-worker-lock-'));
 try{await writeFile(path.join(home,'worker-run.lock'),'fixture');const worker=new MosaicWorker({home});await assert.rejects(worker.cycle(),/Another worker/);}finally{await rm(home,{recursive:true,force:true});}
});

async function finishRun(worker) {
 const until=Date.now()+5000;
 while(worker.running && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(worker.running,false,'worker should release its lock');
 return worker.status;
}

test('manual Run checks public questions for unique current matches even after the submission campaign ended',async t=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-one-run-')),store=new ApplicationStore(home);
 t.after(()=>rm(home,{recursive:true,force:true}));
 const profile={verified:true,facts:{fullName:'Synthetic Applicant'}};
 const policy={enabled:false,submissionMode:'manual',verifiedProfileSha256:digest(profile)};
 const search={titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:150000};
 const campaign={enabled:true,targetConfirmed:1,since:'2020-01-01T00:00:00Z'};
 const url=id=>'https://job-boards.greenhouse.io/example/jobs/'+id;
 const title='Director of Product',base={title,company:'Example',location:'Remote US',compensation:{min:200000,max:240000,currency:'USD',interval:'year'}};
 const rows=[
  {...base,id:'a',url:url(101)},{...base,id:'alias',url:url(101)+'?alternate=other'},
  {...base,id:'missing',url:url(102)},{...base,id:'cheap',url:url(103),compensation:{...base.compensation,min:80000,max:90000}},
  {...base,id:'uncertain',url:url(104)},{...base,id:'later',url:url(105),status:'interview'},
 ];
 const ledger=[
  {id:'past',createdAt:'2020-02-01T00:00:00Z',status:'submitted',url:url(106),receipt:{confirmed:true,posting:url(106)+'/confirmation',text:'Thank you for applying'}},
  {id:'uncertain-alias',url:url(104)+'?source=past',status:'submission_unknown'},
 ];
 await store.write('application-profile.json',profile);await store.write('application-policy.json',policy);
 await store.write('search.json',search);await store.write('worker.json',{enabled:false,maxInspections:10});
 await store.write('jobs.json',rows);await store.write('application-ledger.json',ledger);await store.write('campaign.json',campaign);
 await store.write('connections.json',{boards:[{type:'greenhouse',slug:'discovery-fixture',company:'Unrelated'}]});
 const calls=[];let launches=0;
 const scan=Promise.withResolvers();
 const fetcher=async (input,opts)=>{
  assert.equal(opts.method||'GET','GET');assert.equal(opts.body,undefined);
  const u=new URL(input);calls.push(u.pathname+u.search);
  if(u.pathname.endsWith('/discovery-fixture/jobs')){await scan.promise;return Response.json({jobs:[]});}
  if(u.pathname.endsWith('/102'))return new Response(null,{status:404});
  return Response.json({id:101,title,questions:[{label:'What is your notice period?',required:true,fields:[{name:'question_1',type:'input_text'}]}]});
 };
 const worker=new MosaicWorker({home,fetcher,adapterFactory:async()=>{launches++;throw Error('Unexpected browser');}});
 await worker.pause();
 await assert.rejects(worker.runOnce({submissionMode:'automatic'}),/mode changed/);
 assert.equal(worker.paused,true);
 const {submissionMode,startedAt}=await worker.runOnce({jobIds:rows.map(j=>j.id),submissionMode:'manual'});
 assert.equal(submissionMode,'manual');assert.equal(worker.status.startedAt,startedAt);
 await assert.rejects(worker.runOnce(),/already running/);
 scan.resolve();
 const result=await finishRun(worker);
 assert.equal(result.state,'idle',result.error);assert.equal(result.stage,'finished');
 assert.equal(result.qualityPackets.count,2);
 assert.deepEqual(result.inboxChecks,{checked:1,failed:1,skipped:0});
 const manualView=await prepareQualityPackets({home,jobIds:['cheap']});
 assert.equal(manualView.packets[0].job.id,'cheap','explicit manual preparation can still inspect a near miss');
 assert.equal(manualView.packets[0].quality.ready,false);
 assert.deepEqual(calls.sort(),[
  '/v1/boards/discovery-fixture/jobs?content=true','/v1/boards/example/jobs/101?pay_transparency=true&questions=true',
  '/v1/boards/example/jobs/102?pay_transparency=true&questions=true',
 ]);
 assert.equal((await store.read('greenhouse-inbox.json')).observations.length,1);
 assert.equal(launches,0);assert.equal((await store.read('worker.json')).enabled,false);
 assert.deepEqual(await store.read('application-ledger.json'),ledger);assert.deepEqual(await store.read('campaign.json'),campaign);
 assert.deepEqual(await store.read('application-policy.json'),policy);
});

test('changing to automatic while a manual run scans cannot escalate that run',async t=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-mode-pin-')),store=new ApplicationStore(home);
 t.after(()=>rm(home,{recursive:true,force:true}));
 await store.write('connections.json',{boards:[{type:'greenhouse',slug:'example',company:'Example'}]});
 const scan=Promise.withResolvers();let launches=0;
 const worker=new MosaicWorker({home,fetcher:async()=>{await scan.promise;return Response.json({jobs:[]});},
  adapterFactory:async()=>{launches++;throw Error('Unexpected browser');}});
 await worker.runOnce({submissionMode:'manual'});
 await store.write('application-policy.json',{enabled:true,submissionMode:'automatic',automationRiskAcknowledged:true});
 scan.resolve();
 const status=await finishRun(worker);assert.equal(status.state,'error');assert.match(status.error,/mode changed/);assert.equal(launches,0);
 assert.deepEqual(await store.read('application-ledger.json',[]),[]);
});

test('automatic selection prioritizes the exact reviewed track and records IC blockers without reselecting aliases',async t=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-worker-ranking-')),store=new ApplicationStore(home);
 t.after(()=>rm(home,{recursive:true,force:true}));
 const pdf=Buffer.from('%PDF-1.4 synthetic ranking fixture'),file=path.join(home,'approved.pdf');
 await writeFile(file,pdf);
 const profile={verified:true,facts:{fullName:'Test Person',email:'person@example.invalid'}};
 const pay={min:210000,max:240000,currency:'USD',interval:'year'};
 const make=(id,number,title)=>({id,title,company:'Fixture '+id,location:'Remote US',compensation:pay,
  url:'https://job-boards.greenhouse.io/fixture/jobs/'+number,description:'Annual base salary $210,000–$240,000 USD per year.'});
 const design=make('design',11,'Director of Design'),ic=make('ic',12,'Staff Forward Deployed Engineer');
 const near=make('unknown-pay',21,ic.title),nearBelow=make('below-floor',22,ic.title);
 near.compensation=null;nearBelow.compensation=null;
 const ready=make('ready',13,'Director of Forward Deployed Engineering');
 const interview=make('interview',14,ready.title),offer=make('offer',15,ready.title),unknown=make('unknown',16,ready.title);
 const alias=job=>({...job,id:job.id+'-alias',url:job.url+'?ref=alias',status:'new'});
 const ledger=[{id:'attempt-unknown',jobId:'older-import',url:unknown.url,status:'submission_unknown'}];
 const historyJob=make('history',17,ready.title);
 const jobs=[design,{...interview,status:'interview'},alias(interview),{...offer,status:'offer'},alias(offer),
  alias(unknown),alias(historyJob),ic,alias(ic),near,nearBelow,ready];
 const {seedQuality}=await import('./helpers/quality-fixture.js');
 await seedQuality(home,ready,file);
 // Only the variant in the registry is approved for this grant. The old default is intentionally unavailable.
 await store.write('connections.json',{resume:'unavailable-legacy-product.pdf'});await store.write('application-profile.json',profile);
 await store.write('worker.json',{enabled:false,maxInspections:1});await store.write('jobs.json',jobs);
 await store.write('history.json',[{company:'Archived name',role:'Archived role',posting:historyJob.url}]);
 await store.write('application-ledger.json',ledger);
 await store.write('search.json',{titleLevels:['director'],titleFields:['design','engineering'],localCities:[],minAnnualBaseUsd:190000,
  fdeTarget:{enabled:true,levels:['staff','director']}});
 await store.write('application-policy.json',{enabled:true,submissionMode:'automatic',automationRiskAcknowledged:true,
  requireQualityReview:true,requireICReview:true,applicationResumeTrack:'fde',maxPerDay:15,dailyBudgetUsd:1,
  timezone:'America/Chicago',resumeApprovalPath:'resume-approval.json',verifiedProfileSha256:digest(profile)});
 await configureStandingAuthorization({home,evidence:'Synthetic fixture authorization for the selected track.'});
 const inspections=[],publicChecks=[];
 const fetcher=async(url,options)=>{
  assert.equal(options.method||'GET','GET');assert.equal(options.body,undefined);
  const target=new URL(url);
  assert.equal(target.origin,'https://boards-api.greenhouse.io');
  const id=target.pathname.split('/').at(-1);
  publicChecks.push(id);
  return Response.json({id,title:near.title,location:{name:'Remote US'},content:id==='21'
   ?'Annual base salary $210,000 - $240,000 USD per year.':'Annual base salary $80,000 - $104,000 USD per year.'});
 };
 const worker=new MosaicWorker({home,fetcher,adapterFactory:async()=>({transport:'playwright',recoverReceipt:async attempt=>({confirmed:false,posting:attempt.url}),inspect:async job=>{
  inspections.push(job.id);return {titleVerified:true,description:job.description,location:job.location,salary:pay,
   form:{fields:[],resume:{label:'Résumé'},submit:{label:'Submit'}}};}})});
 await worker.cycle({discover:false,submit:false});
 assert.deepEqual(inspections,['ready']);
 await worker.cycle({discover:false,submit:false});
 let plan=await store.read('application-plan.json');
 const hold=plan.held.find(x=>x.id==='ic');
 assert.ok(hold);assert.ok(hold.questions.includes('Individual-contributor specialization requires review'));
 assert.ok(hold.questions.includes('Complete current role-requirement review needed'));
 await worker.cycle({discover:false,submit:false});
 plan=await store.read('application-plan.json');
 assert.ok(plan.held.some(x=>x.id===near.id && x.questions.includes('Individual-contributor specialization requires review')));
 assert.deepEqual(worker.status.publicPostingChecks,{checked:1,passed:1});
 await worker.cycle({discover:false,submit:false});
 assert.deepEqual(worker.status.publicPostingChecks,{checked:1,passed:0});
 assert.deepEqual(publicChecks,['21','22']);
 plan=await store.read('application-plan.json');
 assert.ok(!plan.held.some(x=>[design.id,nearBelow.id].includes(x.id)));
 assert.ok(!plan.held.some(x=>x.id.endsWith('-alias')));
 assert.deepEqual(inspections,['ready']);
 assert.deepEqual(await store.read('application-ledger.json'),ledger);
});
