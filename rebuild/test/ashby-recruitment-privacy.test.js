import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readDecisionInbox} from '../src/decision-inbox.js';
import {ApplicationStore,digest,fillPlan} from '../src/applications.js';
import {approvedPostingPermission,decidePostingPermission,observeGreenhouseQuestions,readGreenhouseAnswers,readGreenhouseInbox} from '../src/greenhouse-inbox.js';

const job={id:'native',company:'Example Co',title:'Staff Engineer',url:'https://jobs.ashbyhq.com/example/2137a78a-5645-4849-b159-1bc3b49be309'};
const profile={verified:true,answers:[],facts:{}}, profileSha256=digest(profile);
const notice={id:'notice',type:'radio-choice',required:true,value:'',options:['Continue'],
  label:'By continuing, you acknowledge the following: Example Co will collect and use the personal data you provide to us as an applicant for recruitment-related reasons. For a full description of how this information will be used, shared, and protected, and an explanation of the rights that you have in relation to this information, please see the Example Co Privacy Policy. In addition, you understand that your personal information will be transferred to Example Co non-EEA entities as necessary for the purposes of considering your application for a role.',
  description:'Example Co Privacy Policy',policyLinks:[{text:'Privacy Policy',url:'https://example.com/privacy'}]};
const form={fields:[notice],resume:{label:'CV'},submit:{label:'Submit application'}};
async function setup(t){
  const root=await mkdtemp(path.join(tmpdir(),'mosaic-notice-'));
  t.after(()=>rm(root,{force:true,recursive:true}));
  const store=new ApplicationStore(root);
  await store.write('jobs.json',[job]);await store.write('application-profile.json',profile);
  return store;
}
const observe=(store,current=form,channel='worker')=>observeGreenhouseQuestions({store,job,form:current,missing:current.fields.map(f=>f.label),channel,profileSha256});
const decide=(store,item,decision)=>decidePostingPermission({store,jobId:item.jobId,id:item.id,revision:item.revision,decision});
test('Ashby recruitment transfer requires the candidate decision on this posting and exact notice and form',async t=>{
 const store=await setup(t);
 await observe(store);
 const before=await readGreenhouseInbox(store);
 assert.equal(before.items.length,0);assert.deepEqual(before.readyJobIds,[]);
 const [item]=before.permissions;
 assert.equal(item.purpose,'recruitment-privacy');assert.equal(item.fields[0].label,notice.label);
 assert.deepEqual(item.fields[0].links,[notice.policyLinks[0].url]);assert.equal(item.fields[0].answer,'Continue');
 const inputs={job,form,profileSha256};assert.equal(approvedPostingPermission(await readGreenhouseAnswers(store),inputs),null);
 assert.deepEqual(fillPlan(form,profile,{job}).missing,[notice.label]);
 await assert.rejects(decide(store,{...item,revision:'expired'},'allow'),/changed/i);
 assert.deepEqual((await decide(store,item,'allow')).jobIds,[job.id]);
 const state=await readGreenhouseAnswers(store),permission=approvedPostingPermission(state,inputs);
 assert.equal(permission.fields[0].answer,'Continue');assert.equal(fillPlan(form,profile,{job,permission}).actions[0].value,'Continue');
 assert.ok(approvedPostingPermission(state,{...inputs,form:{...form,fields:[{...notice,value:'Continue'}]}}));
 for (const updates of [
  {profileSha256:'other'}, {job:{...job,id:'other'}}, {job:{...job,url:job.url.replace('example/','another/')}}, {job:{...job,title:'Other'}},
  {form:{...form,fields:[{...notice,label:notice.label+' I waive all rights.'}]}},
  {form:{...form,fields:[{...notice,description:notice.description+' and terms of service'}]}},
  {form:{...form,fields:[{...notice,policyLinks:[{text:'Privacy Policy',url:'https://example.com/legal/privacy'}]}]}},
  {form:{...form,fields:[{...notice,required:false}]}}, {form:{...form,fields:[{...notice,options:['Continue','Other']}]}},
  {form:{...form,fields:[notice,{id:'other',label:'Other',type:'text'}]}}
 ]) assert.equal(approvedPostingPermission(state,{...inputs,...updates}),null);
 assert.equal((await store.read('application-profile.json')).answers.length,0);
});
test('no suggestion for ambiguous, restrictive, already checked or non-worker notices; skip suppresses the job',async t=>{
 const store=await setup(t);
 for(const f of [
  {...notice,value:'Continue'}, {...notice,label:notice.label+' I agree to binding arbitration.'},
  {...notice,description:'Consent to a background check.'}, {...notice,required:false},
  {...notice,policyLinks:[{text:'Privacy Policy',url:'https://example.com/terms'}]},
  {...notice,policyLinks:[{text:'Privacy Policy',url:'javascript:alert(1)'}]},
  {...notice,type:'textarea'}, {...notice,options:['Continue','Consent to marketing']}
 ]){
  await observe(store,{...form,fields:[f]});assert.equal((await readGreenhouseInbox(store)).permissions,undefined);
 }
 await observe(store,{...form,fields:[notice,notice]});assert.equal((await readGreenhouseInbox(store)).permissions,undefined);
 await observe(store,form,'manual');assert.equal((await readGreenhouseInbox(store)).permissions,undefined);
 await observe(store);
 await store.write('application-plan.json',{held:[{id:job.id,reason:'Missing verified answers or supported controls',questions:[notice.label]}]});
 const [item]=(await readGreenhouseInbox(store)).permissions;
 assert.deepEqual((await decide(store,item,'skip')).jobIds,[]);
 await observe(store);
 const inbox=await readGreenhouseInbox(store);assert.equal(inbox.permissions,undefined);assert.deepEqual(inbox.readyJobIds,[]);
 assert.equal(approvedPostingPermission(await readGreenhouseAnswers(store),{job,form,profileSha256}),null);
 assert.deepEqual((await readDecisionInbox(store)).reviews,[]);
});
test('Chrome shows a complete Ashby notice and separately preserves unfinished applicant writing', {
  skip:process.env.MOSAIC_BROWSER_TESTS!=='1',timeout:30000
},async t=>{
  const {spawn}=await import('node:child_process'), {once}=await import('node:events');
  const {chromium}=await import('playwright');
  const {inspectAshbyGroups}=await import('../src/ashby-form-groups.js');
  const store=await setup(t);
  const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
  const child=spawn(process.execPath,[new URL('../src/server.js',import.meta.url).pathname],
    {env:{...process.env,ROLEMOSAIC_HOME:store.root,PORT:'0'},stdio:['ignore','pipe','pipe']});
  try{
    const [banner]=await once(child.stdout,'data',{signal:AbortSignal.timeout(6000)});
    const base=String(banner).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const page=await browser.newPage(), outbound=[];page.setDefaultTimeout(5000);
    await page.route('**/*',route=>{if (new URL(route.request().url()).origin===base)return route.continue();outbound.push(route.request().url());return route.abort();});
    await page.setContent('<fieldset class="ashby-application-form-input-radio-group">'+
      '<label class="ashby-application-form-question-title required" for="notice">'+notice.label+'</label>'+
      '<div class="ashby-application-form-question-description"><p>Example Co<a href="https://example.com/privacy"> Privacy Policy</a></p></div>'+
      '<div><input type="radio" id="continue"><label for="continue">Continue</label></div></fieldset>');
    const [observed]=await page.evaluate(inspectAshbyGroups);
    const narrative={id:'story',type:'textarea',required:true,label:'Describe the project you delivered.'};
    await observe(store,{...form,fields:[observed,narrative]});
    await store.write('application-plan.json',{packets:[],held:[{id:job.id,reason:'Missing verified answers or supported controls',questions:[observed.label,narrative.label]}]});
    await page.goto(base+'/#inbox');
    const card=page.locator('fieldset').filter({has:page.getByRole('button',{name:'Allow this recruitment privacy acknowledgement'})});
    await card.waitFor();
    assert.ok((await card.innerText()).includes(notice.label));
    assert.equal(await card.getByRole('link').getAttribute('href'),notice.policyLinks[0].url);
    assert.ok(await card.getByRole('button',{name:'Skip this application'}).isVisible());
    assert.ok(await page.getByText(narrative.label,{exact:true}).first().isVisible());
    const saved=page.waitForResponse(r=>r.url()===base+'/api/inbox/posting-permission'&&r.request().method()==='POST');
    await card.getByRole('button',{name:'Allow this recruitment privacy acknowledgement'}).click();
    assert.equal((await saved).status(),200);
    assert.deepEqual((await readGreenhouseInbox(store)).readyJobIds,[]);
    const state=await readGreenhouseAnswers(store);
    assert.equal(approvedPostingPermission(state,{job,profileSha256,form:{...form,fields:[observed,narrative]}}).fields[0].answer,'Continue');
    assert.deepEqual(await store.read('application-ledger.json',[]),[]);assert.deepEqual(outbound,[]);
  }finally{
    await browser.close();
    if(child.exitCode===null&&!child.signalCode){const stopped=once(child,'exit');child.kill();await stopped;}
  }
});
