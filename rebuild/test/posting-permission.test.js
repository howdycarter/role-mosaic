import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ApplicationStore,digest} from '../src/applications.js';
import {approvedPostingPermission,bindObservedPostingPermission,decidePostingPermission,readGreenhouseInbox,readGreenhouseAnswers,observeGreenhouseQuestions} from '../src/greenhouse-inbox.js';

const base='https://job-boards.greenhouse.io/example/jobs/';
const job={id:'new',company:'Example',title:'Engineer',url:base+'456'};
const privacy={id:'privacy',label:'I agree to the Candidate Privacy Policy.',type:'select',required:true,
  options:['I agree'],policyLinks:['https://example.org/privacy']};
const demographic={id:'identity',label:'What is your gender identity?',type:'select',required:true,options:['I decline to answer']};
const consent={id:'data',label:'I consent to demographic data processing.',type:'checkbox',required:true};
const form={fields:[privacy,demographic,consent]}, missing=form.fields.map(f=>f.label);
const records=form.fields.map((field,index)=>({question:field.label,verified:true,scopePostingKey:'greenhouse:123',
  answer:field.options?.[0]||'true',...(index===1?{}:{kind:'privacy-consent'})}));
const profile={verified:true,answers:records,facts:{}},profileSha256=digest(profile);

async function prepare(t,previous=base+'123'){
  const home=await mkdtemp(path.join(os.tmpdir(),'permission-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new ApplicationStore(home);
  await store.write('jobs.json',[job]);await store.write('application-profile.json',profile);
  await store.write('application-ledger.json',[{url:previous,status:'submitted'}]);
  await observeGreenhouseQuestions({store,job,form,missing,profileSha256});
  return store;
}

test('one explicit decision binds all displayed choices to the current recipient, profile, policy link and form',async t=>{
  const store=await prepare(t);
  const inputs={job,form,profileSha256};
  const before=await readGreenhouseInbox(store);
  assert.equal(before.items.length,0);
  assert.deepEqual(before.readyJobIds,[]);
  const [p]=before.permissions;
  assert.deepEqual(p.fields.map(f=>f.answer),['I agree','I decline to answer','true']);
  assert.deepEqual(p.fields[0].links,privacy.policyLinks);
  const decide={store,id:p.id,jobId:job.id,revision:p.revision,decision:'allow'};
  assert.equal(approvedPostingPermission(await readGreenhouseAnswers(store),inputs),null);
  await assert.rejects(decidePostingPermission({...decide,revision:'outdated'}),/changed/);
  assert.deepEqual((await decidePostingPermission(decide)).jobIds,[job.id]);
  assert.deepEqual((await readGreenhouseInbox(store)).readyJobIds,[job.id]);
  const state=await readGreenhouseAnswers(store);
  assert.equal(approvedPostingPermission(state,inputs).fields.length,3);
  for(const changed of [{profileSha256:'changed'},{job:{...job,url:base+'789'}},
    {form:{fields:[{...privacy,policyLinks:['https://example.org/changed']},demographic,consent]}}]){
    assert.equal(approvedPostingPermission(state,{...inputs,...changed}),null);
  }
  assert.deepEqual(await store.read('application-profile.json'),profile);
});
test('skip suppresses the repeated request, and a different employer cannot propose these disclosures',async t=>{
  const store=await prepare(t);
  const [item]=(await readGreenhouseInbox(store)).permissions;
  await decidePostingPermission({store,id:item.id,jobId:job.id,revision:item.revision,decision:'skip'});
  await observeGreenhouseQuestions({store,job,form,missing,profileSha256});
  const current=await readGreenhouseInbox(store);
  assert.equal(current.permissions,undefined);assert.deepEqual(current.readyJobIds,[]);
  assert.equal(approvedPostingPermission(await readGreenhouseAnswers(store),{job,form,profileSha256}),null);
  const other=await prepare(t,base.replace('/example/','/another/')+'123');
  assert.equal((await readGreenhouseInbox(other)).permissions,undefined);
});

test('legacy consent requires exact old and new revisions from one unchanged observation',async t=>{
  const store=await prepare(t);
  const oldPrivacy={...privacy,description:'Select... Read how we process data.'};
  const oldDemographic={...demographic,description:'Select...'};
  const oldForm={fields:[oldPrivacy,oldDemographic,consent]};
  const observe={store,job,profileSha256};
  await observeGreenhouseQuestions({...observe,form:oldForm,missing});
  const [item]=(await readGreenhouseInbox(store)).permissions;
  await decidePostingPermission({store,id:item.id,jobId:job.id,revision:item.revision,decision:'allow'});

  // Both descriptions come from one native inspection. The stable help excludes
  // only the widget display. The old projection retains its originally observed text.
  const newPrivacy={...oldPrivacy,description:'Read how we process data.',legacyDescription:oldPrivacy.description};
  const newDemographic={...oldDemographic,description:'',legacyDescription:oldDemographic.description};
  const blank={fields:[newPrivacy,newDemographic,{...consent,value:'false'}]};
  const read=()=>readGreenhouseAnswers(store);
  const lookup=(state,current)=>approvedPostingPermission(state,{job,profileSha256,form:current});
  assert.equal(lookup(await read(),blank),null);
  const original=await read();
  for(const current of [
    {fields:[newPrivacy,{...newDemographic,value:'Different selection'},consent]},
    {fields:[newPrivacy,newDemographic,{...consent,value:'true'}]},
    {fields:[{...newPrivacy,legacyDescription:'Select... New substantive disclosure.'},newDemographic,consent]},
    {fields:[newPrivacy,newDemographic,consent,{id:'extra',label:'New question',type:'text',required:true}]},
  ]){
    assert.equal(await bindObservedPostingPermission({...observe,form:current}),null);
  }
  assert.deepEqual(await read(),original);
  const migrated=await bindObservedPostingPermission({...observe,form:blank});
  assert.equal(migrated.requestId,item.id);
  assert.deepEqual(migrated.fields.map(f=>f.answer),original.permissions[0].fields.map(f=>f.answer));
  const bound=await read();
  assert.equal(bound.permissions.length,1);
  assert.equal(bound.permissions[0].stamp,item.revision);
  assert.deepEqual(bound.permissions[0].fields,original.permissions[0].fields);
  assert.equal(bound.permissions[0].binding.sourceStamp,item.revision);
  const filled={fields:[{...newPrivacy,value:'I agree',legacyDescription:'I agree Read how we process data.'},
    {...newDemographic,value:'I decline to answer',legacyDescription:'I decline to answer'}, {...consent,value:'true'}]};
  assert.equal(lookup(bound,filled).requestId,item.id);
  assert.deepEqual(await bindObservedPostingPermission({...observe,form:blank}),migrated);
  for(const fields of [
    [{...newPrivacy,description:'A new disclosure.'},newDemographic,consent],
    [{...newPrivacy,policyLinks:['https://example.org/revised']},newDemographic,consent],
    [{...newPrivacy,required:false},newDemographic,consent],
    [newPrivacy,{...newDemographic,value:'Different selection'},consent],
    [newPrivacy,{...newDemographic,options:['I decline to answer','New option']},consent],
    [newPrivacy,{...newDemographic,id:'new-id'},consent],
    [newPrivacy,{...newDemographic,type:'checkbox'},consent],[newPrivacy,newDemographic,newDemographic,consent],
  ])assert.equal(lookup(bound,{fields}),null);
  const modified=structuredClone(bound);
  modified.permissions[0].fields[0].answer='Different answer';
  assert.equal(lookup(modified,filled),null);
});
