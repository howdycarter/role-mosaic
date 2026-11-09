import {test} from 'node:test';import assert from 'node:assert/strict';
import {axIndex,postingLocation} from '../src/browser-adapter.js';
import {optionForAnswer,sameAnswer} from '../src/application-values.js';
test('negative prior-employment answer matches an explicit never-worked option, not a positive employment history',()=>{
 const field={label:'Are you now, or have you ever been employed by Example? *'};
 const options=['Yes, I have worked at Example in the past','Yes, I am currently employed by Example','No, I have never worked at Example'];
 assert.equal(optionForAnswer(field,'No',options),options[2]);assert.equal(sameAnswer(field,options[2],'No'),true);assert.equal(sameAnswer(field,options[0],'No'),false);
 assert.equal(optionForAnswer({label:'Do you need sponsorship?'},'No',options),undefined);
});
test('explicit US remote policy is separated from hybrid office branding and respects qualification exceptions',()=>{
 const policy='Santa Monica, CA/Remote\nWe offer a hybrid work environment. Most US-based positions can also be performed remotely (any exceptions will be noted in the Minimum Qualifications below.)\n';
 assert.equal(postingLocation(policy+'Minimum Qualifications:\n10+ years designing products.\nPreferred Qualifications:\nAI tooling.'),'Remote, United States');
 assert.notEqual(postingLocation(policy+'Minimum Qualifications:\nThis role must reside in California and work on-site.\nPreferred Qualifications:'),'Remote, United States');
 assert.equal(postingLocation('VP Product\nRemote - USA'),'Remote, United States');
 assert.equal(postingLocation('VP Product\nRemote - US, excluding Texas'),'Location restrictions require review');
});
test('AX controls use exact observed ids and label fallback when the browser omits an id',()=>{
 const ax='102 text field (settable) Description: First Name, Value: Example, ID: first_name\n105 text field (settable) Description: Last Name, ID: last_name\n108 text field (settable) Email\n114 combo box (collapsed, settable) Country, ID: country, Secondary Actions: Expand\n126 button Attach, ID: resume';
 assert.equal(axIndex(ax,{id:'email',label:'Email*'}),108);
 assert.equal(axIndex(ax,{id:'first_name',label:'First Name*'}),102);
 assert.equal(axIndex(ax,{id:'resume',label:'Attach'}),126);
 assert.equal(axIndex(ax,{id:'country',label:'Country*'}),114);
 assert.throws(()=>axIndex(ax+'\n150 text field (settable) Email',{id:'unknown',label:'Email'}),/unique/);
});

test('the file chooser uses the observed visible trigger and persists exact PDF upload evidence',async()=>{
 const {CodexBrowserAdapter}=await import('../src/browser-adapter.js');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-upload-'));const events=[];
 try{
  const resume=path.join(root,'own.pdf');await writeFile(resume,'%PDF-1.4\nfixture');
  const tab={ax:{get:async()=>''},playwright:{waitForEvent:()=>{events.push('listen');return Promise.resolve({setFiles:async files=>{assert.equal(files[0],resume);events.push('upload')}})},locator:selector=>({click:async()=>{assert.equal(selector,'div:has(> input#resume) > button');events.push('visible-click')}})}};
  const adapter=new CodexBrowserAdapter({}, {home:root});
  const result=await adapter.fill({job:{id:'fixture'},tab,form:{resume:{label:'Attach',triggerSelector:'div:has(> input#resume) > button'}}},[],resume);
  assert.deepEqual(events,['listen','visible-click','upload']);assert.equal(result.resumeUpload.filename,'own.pdf');assert.equal(result.resumeUpload.sha256.length,64);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('confirmation waits for delayed same-posting receipt and never invokes a click',async()=>{
 const {CodexBrowserAdapter}=await import('../src/browser-adapter.js');const {mkdtemp,readFile,rm}=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-receipt-'));let reads=0;
 try{
  const url='https://job-boards.greenhouse.io/example/jobs/123';
  const tab={ax:{get:async()=>++reads===1?'Application form':'Thank you for applying. Your application has been received.'},playwright:{evaluate:async()=>({url:url+'/confirmation',hasInputs:false,hasSubmit:false})},screenshot:async()=>Buffer.from('synthetic screenshot')};
  const adapter=new CodexBrowserAdapter({}, {home:root});const result=await adapter.confirm({job:{id:'fixture',url},tab,tabId:'fixture-tab'});
  assert.equal(result.confirmed,true);assert.ok(reads>=2);assert.equal((await readFile(result.screenshot)).toString(),'synthetic screenshot');
 }finally{await rm(root,{recursive:true,force:true});}
});
