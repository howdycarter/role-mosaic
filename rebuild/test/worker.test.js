import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ApplicationStore,digest,approvePackets} from '../src/applications.js';import {MosaicWorker} from '../src/worker.js';
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
  await worker.cycle({discover:false});assert.deepEqual(await s.read('application-plan.json'),original);assert.equal(inspections,1);assert.equal(submits,0);
  await approvePackets({home,ids:original.packets.map(p=>p.id)});await worker.cycle({discover:false,prepare:false});assert.equal(submits,1);assert.equal(fills,1);
  await worker.cycle({discover:false,prepare:false});assert.equal(submits,1);assert.equal((await s.read('history.json')).length,1);
  await worker.pause();await worker.cycle({discover:false});assert.equal(submits,1);assert.equal(worker.status.state,'paused');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('a second worker cannot enter a workspace already owned by a live cycle',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-worker-lock-'));
 try{await writeFile(path.join(home,'worker-run.lock'),'fixture');const worker=new MosaicWorker({home});await assert.rejects(worker.cycle(),/Another worker/);}finally{await rm(home,{recursive:true,force:true});}
});
