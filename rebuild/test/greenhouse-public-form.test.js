import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore, digest } from '../src/applications.js';
import { answerGreenhouseQuestion, readGreenhouseInbox } from '../src/greenhouse-inbox.js';
import { checkPacketQuestions } from '../src/manual-greenhouse-questions.js';
import { publicGreenhouseForm, enrichGreenhouseFields } from '../src/greenhouse-public-form.js';
import { prepareQualityPackets } from '../src/packets.js';
import { seedQuality } from './helpers/quality-fixture.js';

const notice = { label: 'What is your notice period?', required: true,
  fields: [{ name: 'question_42', type: 'multi_value_single_select', values: [{label: 'One week'}, {label: 'Two weeks'}] }] };

test('Greenhouse public choices attach only to the uniquely matching live field, preserving employer context', () => {
  const publicForm = publicGreenhouseForm([{ ...notice, description: '<p>For this assignment only</p>' },
    { ...notice, fields: [{ name: 'question_77', type: 'multi_value_multi_select' }] },
    { ...notice, required: false }, { ...notice, fields: [{ name: 'email', type: 'input_text' }] }]);
  assert.equal(publicForm.fields.length, 1);
  const valid = { type: 'select', id: 'question_42', label: notice.label + '*', options: [] };
  const copy = () => ({ ...valid, options: [] });
  const other = { ...copy(), id: 'question_123' };
  for (const fields of [[copy(), copy()], [other], [{ ...copy(), label: 'Other question' }]]) {
    enrichGreenhouseFields(fields, publicForm);
    assert.deepEqual(fields[0].options, []);
  }
  enrichGreenhouseFields([valid], publicForm);
  assert.deepEqual(valid.options, ['One week', 'Two weeks']);
  assert.equal(valid.description,'For this assignment only');
});

test('manual Greenhouse packet reads public questions, saves a scoped answer and shows it without transmitting applicant data', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mosaic-gh-manual-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ApplicationStore(home);
  const job = { id:'job', title:'Director of Product', company:'Example', location:'Remote US', description:'Product leadership',
    url:'https://job-boards.greenhouse.io/example/jobs/1402', compensation:{currency:'USD',interval:'year',min:180000,max:240000} };
  await store.write('jobs.json',[job]);
  await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:170000});
  const profile = {verified:true,facts:{fullName:'Example Person',email:'private@example.invalid'},answers:[]};
  await store.write('application-profile.json',profile);
  await store.write('application-policy.json',{enabled:false,submissionMode:'manual',verifiedProfileSha256:digest(profile)});
  const pdf = path.join(home,'example.pdf');
  await writeFile(pdf,'%PDF-1.4 Synthetic offline test');
  await seedQuality(home,job,pdf);
  const {packets:[packet]} = await prepareQualityPackets({ home,jobIds:[job.id] });
  let calls = 0;
  async function fetcher(url,options) {
    calls++;
    assert.equal(url,'https://boards-api.greenhouse.io/v1/boards/example/jobs/1402?pay_transparency=true&questions=true');
    assert.equal(options.redirect,'error');
    assert.equal(options.body,undefined);
    assert.equal(options.headers,undefined);
    assert.ok(!options.method||options.method==='GET');
    return Response.json({id:1402,title:job.title,questions:[notice]});
  }
  assert.equal((await checkPacketQuestions({store,packetId:packet.id,fetcher})).checked,1);
  const inbox = await readGreenhouseInbox(store);
  assert.equal(inbox.items.length,1);
  const item = inbox.items[0];
  const {jobId,channel,revision} = item.postings[0];
  assert.equal(channel,'manual');
  const result = await answerGreenhouseQuestion({store,id:item.id,jobId,channel,revision,scope:'posting',answer:'One week',confirm:true});
  assert.deepEqual(result.jobIds,[]);
  const {saved} = await checkPacketQuestions({store,packetId:packet.id,fetcher});
  assert.deepEqual(saved, [{ label: notice.label, answer: 'One week' }]);
  assert.deepEqual((await readGreenhouseInbox(store)).items,[]);
  assert.deepEqual(await store.read('application-ledger.json',[]),[]);
  await store.write('application-ledger.json',[{jobId:job.id,url:job.url,status:'submission_unknown'}]);
  await assert.rejects(checkPacketQuestions({store,packetId:packet.id,fetcher}),/current Greenhouse/);
  assert.equal(calls,2);
});
