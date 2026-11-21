import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore, digest } from '../src/applications.js';
import { answerGreenhouseQuestion, forgetGreenhouseAnswer, greenhouseAnswerFor, greenhousePosting, greenhouseRetryJobs,
  observeGreenhouseQuestions, readGreenhouseAnswers, readGreenhouseInbox } from '../src/greenhouse-inbox.js';

const job = (id, board = 'example') => ({ id: 'job-' + id, company: 'Same Display Name',
  title: 'Engineering Opening ' + id, url: 'https://job-boards.greenhouse.io/' + board + '/jobs/' + id });
const a = job(123), b = job(456), c = job(789, 'other');
const profile = { verified: true, facts: { firstName: 'Example' } };
const profileSha256 = digest(profile);
const note = { id: 'a', label: 'What is your notice period? *', type: 'text', required: true };
const previous = { id: 'b', label: 'Have you ever worked for this company?', type: 'select', options: ['Select…', 'Yes', 'No'], required: true };
const manual = { id: 'c', label: 'Security verification code', type: 'text', required: true };
const formFor = (...fields) => ({ fields, resume: { label: 'Resume' }, submit: { label: 'Submit' } });

async function workspace(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'greenhouse-inbox-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ApplicationStore(home);
  await store.write('application-profile.json', profile);
  await store.write('jobs.json', [a, b, c]);
  return store;
}

async function see(store, job, form, channel = 'worker') {
  await observeGreenhouseQuestions({ store, job, form, missing: form.fields.map(field => field.label), profileSha256, channel });
}

function save(store, item, job, scope, answer) {
  const selected = item.postings.find(p => p.jobId === job.id);
  return answerGreenhouseQuestion({ store, id: item.id, jobId: job.id, scope, answer, confirm: true,
    channel: selected.channel, revision: selected.revision });
}

test('one verified reusable answer survives restart without changing the verified profile; manual work never wakes the worker', async t => {
  const store = await workspace(t);
  await see(store, a, formFor(note));
  await see(store, b, formFor({ ...note, id: 'another', label: 'What is your notice period?' }));
  await see(store, c, formFor(note), 'manual');
  const { items, waitingJobIds } = await readGreenhouseInbox(store);
  assert.equal(items.length, 1);
  assert.equal(items[0].postings.length, 3);
  assert.deepEqual(waitingJobIds, [a.id, b.id]);
  const { jobIds } = await save(store, items[0], a, 'future', 'Two weeks');
  assert.deepEqual(jobIds, [a.id, b.id]);
  assert.deepEqual(await (new ApplicationStore(store.root)).read('application-profile.json'), profile);
  const again = new ApplicationStore(store.root);
  const summary = await readGreenhouseInbox(again);
  assert.equal(summary.items.length, 0);
  assert.equal(summary.savedAnswers.length, 1);
  assert.equal(JSON.stringify(summary).includes('Two weeks'), false);
  assert.equal((await stat(path.join(store.root, 'greenhouse-inbox.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await greenhouseRetryJobs(again), [a.id, b.id]);
  const state = await readGreenhouseAnswers(again);
  const answer = (job, field, form, extra = {}) => greenhouseAnswerFor(state, { job, field, form, profileSha256, ...extra });
  assert.equal(answer(c, note, formFor(note)), 'Two weeks');
  const withHelp = { ...note, description: 'This answer only concerns the next project' };
  assert.equal(answer(c, withHelp, formFor(withHelp)), undefined);
  assert.equal(answer(a, note, formFor(note), { profileSha256: 'changed' }), undefined);
  assert.equal(answer({ ...a, url: a.url.replace('greenhouse.io', 'greenhouse.invalid') }, note, formFor(note)), undefined);
  await store.write('application-profile.json', { ...profile, facts: { firstName: 'Different' } });
  assert.deepEqual((await readGreenhouseInbox(store)).savedAnswers, []);
});

test('employer scope follows the exact tenant, checks observed choices, and cannot be expanded after the click', async t => {
  const store = await workspace(t);
  for (const j of [a, b, c]) await see(store, j, formFor(previous));
  const { items } = await readGreenhouseInbox(store);
  assert.equal(items.length, 2);
  const item = items.find(q => q.postings.some(p => p.jobId === a.id));
  assert.deepEqual(item.scopes, ['posting', 'employer']);
  assert.deepEqual(item.options, ['Yes', 'No']);
  await assert.rejects(save(store, item, a, 'future', 'No'), /scope/);
  await assert.rejects(save(store, item, a, 'employer', 'Maybe'), /valid answer/);
  await assert.rejects(answerGreenhouseQuestion({ store, id: item.id, jobId: a.id, scope: 'posting', answer: 'No' }), /confirm/);
  assert.deepEqual((await save(store, item, a, 'posting', 'No')).jobIds, [a.id]);
  assert.deepEqual((await save(store, item, a, 'posting', 'No')).jobIds, []);
  await assert.rejects(save(store, item, a, 'employer', 'No'), /stale/);
  const fresh = (await readGreenhouseInbox(store)).items.find(q => q.postings.some(p => p.jobId === b.id));
  await save(store, fresh, b, 'employer', 'Yes');
  const state = await readGreenhouseAnswers(store);
  const answer = (j, f) => greenhouseAnswerFor(state, { job: j, field: f, form: formFor(f), profileSha256 });
  assert.equal(answer(a, previous), 'No');
  assert.equal(answer(b, previous), 'Yes');
  assert.equal(answer(c, previous), undefined);
  assert.equal(answer(b, { ...previous, options: ['Yes', 'No', 'Other'] }), undefined);
  await store.write('application-ledger.json', [{ jobId: a.id, status: 'submission_unknown', url: a.url }]);
  assert.deepEqual(await greenhouseRetryJobs(store), [b.id]);
});

test('sensitive prompts, unknown controls, ambiguous labels and other blockers stay out of reusable answers', async t => {
  const store = await workspace(t);
  const unsupported = [
    manual, { ...manual, label: 'I certify this information is accurate.' },
    { ...manual, label: 'Typed legal signature' }, { ...manual, label: 'Select a color', type: 'select', options: [] },
    { ...manual, label: 'Have you used this service?', type: 'checkbox' }, { ...note, label: 'Why here?', description: 'x'.repeat(1201) },
    { ...manual, label: 'Price', id: 'p1' }, { ...manual, label: 'Price', id: 'p2' },
  ];
  await see(store, a, formFor(...unsupported, { ...note, value: 'private current input' }));
  const { items } = await readGreenhouseInbox(store);
  assert.equal(items.length, 1);
  const bytes = await readFile(path.join(store.root, 'greenhouse-inbox.json'), 'utf8');
  assert.ok(!bytes.includes('private current input'));
  assert.ok(!bytes.includes('Security verification'));
  assert.deepEqual((await save(store, items[0], a, 'future', 'Two weeks')).jobIds, []);
});

test('Ashby native choices require exact observed options and a posting-bound answer', async t => {
  const store = await workspace(t);
  const ashby = {...a,url:'https://jobs.ashbyhq.com/example/12345678-1234-1234-1234-123456789012'};
  await store.write('jobs.json',[ashby]);
  const travel = {id:'travel',type:'button-choice',label:'Can you travel quarterly?',required:true,options:['Yes','No']};
  const years = {id:'years',type:'radio-choice',label:'Years of experience?',required:true,options:['3–5','6+']};
  const sensitive = [
    {...travel,id:'pledge',label:'Your confirmation',options:['I accept','Decline']},
    {...travel,id:'help',label:'Your selection',description:'This authorizes a background check.'},
    {...travel,id:'links',label:'Your response',policyLinks:[{url:'https://example.invalid/privacy'}]},
    {...years,id:'other',label:'Prior service',options:['Veteran','Other']},
    {...years,id:'dupe',label:'Pick a range',options:['6+',' 6+ ']},
  ];
  const form = formFor(travel,years,...sensitive);
  await see(store,ashby,form);
  const {items,permissions}=await readGreenhouseInbox(store);
  assert.equal(permissions,undefined);
  assert.equal(items.length,2);
  for(const [field,value] of [[travel,'Yes'],[years,'6+']]){
    const item=items.find(i=>i.label===field.label);
    assert.deepEqual(item.scopes,['posting']);assert.deepEqual(item.options,field.options);
    await assert.rejects(save(store,item,ashby,'future',value),/scope|stale/);
    await assert.rejects(save(store,item,ashby,'posting',value+' '),/valid answer/);
    await save(store,item,ashby,'posting',value);
    const state=await readGreenhouseAnswers(store);
    const use=(job,field,form)=>greenhouseAnswerFor(state,{job,field,form,profileSha256});
    assert.equal(use(ashby,field,form),value);
    assert.equal(use(a,field,form),undefined);
    const changed={...field,options:[...field.options].reverse()};
    assert.equal(use(ashby,changed,formFor(changed)),undefined);
  }
  assert.deepEqual((await readGreenhouseAnswers(store)).permissions||[],[]);
  assert.deepEqual(await greenhouseRetryJobs(store),[]);
});

test('posting-specific answer is pinned to the observed form, can be forgotten, and stale forms cannot recreate it', async t => {
  const store = await workspace(t);
  const field = { ...note, label: 'Describe the system this team should build.' }, form = formFor(field);
  await see(store, a, form);
  const { items } = await readGreenhouseInbox(store);
  assert.deepEqual(items[0].scopes, ['posting']);
  await save(store, items[0], a, 'posting', 'Start with the service contract.');
  let state = await readGreenhouseAnswers(store);
  assert.equal(greenhouseAnswerFor(state, { job: a, field, form, profileSha256 }), 'Start with the service contract.');
  assert.equal(greenhouseAnswerFor(state, { job: a, field, form: formFor(field, manual), profileSha256 }), undefined);
  const [grant] = (await readGreenhouseInbox(store)).savedAnswers;
  await forgetGreenhouseAnswer({ store, id: grant.id });
  state = await readGreenhouseAnswers(store);
  assert.equal(greenhouseAnswerFor(state, { job: a, field, form, profileSha256 }), undefined);
  await assert.rejects(save(store, items[0], a, 'posting', 'Start with the service contract.'), /stale/);
  const fresh = (await readGreenhouseInbox(store)).items[0];
  assert.notEqual(fresh.id, items[0].id);
  await observeGreenhouseQuestions({ store, job: a, form: null, missing: [], profileSha256 });
  assert.deepEqual((await readGreenhouseInbox(store)).items, []);
});

test('Greenhouse collection requires an unambiguous official posting and excludes confirmation pages', async t => {
  const store = await workspace(t);
  for (const raw of [a.url + '?gh_jid=456', a.url.replace('https://', 'https://someone@'), a.url.replace('https:', 'http:'),
    a.url + '/application?gh_jid=123&gh_jid=456', a.url.replace('/123', '/123/completely/different')]) {
    assert.equal(greenhousePosting(raw), null);
  }
  for (const j of [{ ...a, url: a.url + '/confirmation' }, { ...a, url: a.url.replace('greenhouse.io', 'other.invalid') }]) {
    await see(store, j, formFor(note));
  }
  assert.equal((await readGreenhouseInbox(store)).items.length, 0);
});

test('an unrelated in-flight application does not block answering; concurrent updates preserve grants and observations', async t => {
  const store = await workspace(t);
  const unrelated = { ...note, id: 'd', label: 'Describe the prototype for our team.' };
  await Promise.all([see(store, b, formFor(unrelated)), see(store, a, formFor(note)), see(store, c, formFor(note))]);
  const { items } = await readGreenhouseInbox(store);
  const shared = items.find(item => item.scopes.includes('future'));
  const single = items.find(item => item.scopes.length === 1);
  await store.lock(async () => {
    const results = await Promise.all([save(store, single, b, 'posting', 'Test design'), save(store, shared, a, 'future', 'Two weeks')]);
    assert.deepEqual(results[0].jobIds, [b.id]);
    assert.deepEqual([...results[1].jobIds].sort(), [a.id, c.id]);
    const state = await readGreenhouseInbox(store);
    assert.equal(state.savedAnswers.length, 2);
    await assert.rejects(forgetGreenhouseAnswer({ store, id: state.savedAnswers[0].id }), /Another application/);
  });
  assert.equal((await readGreenhouseInbox(store)).items.length, 0);
});


test('a crashed inbox writer releases its turn to a new process without dropping prior grants', async t => {
  const store = await workspace(t);
  await see(store, a, formFor(note));
  const [item] = (await readGreenhouseInbox(store)).items;
  await save(store, item, a, 'posting', 'Three weeks');
  const applicationUrl = new URL('../src/applications.js', import.meta.url).href;
  const inboxUrl = new URL('../src/greenhouse-inbox.js', import.meta.url).href;
  const script = `
    import {ApplicationStore} from ${JSON.stringify(applicationUrl)};
    import {observeGreenhouseQuestions} from ${JSON.stringify(inboxUrl)};
    const store = new ApplicationStore(process.argv[1]);
    store.write = async () => {
      process.stdout.write('in critical section');
      await new Promise(() => setInterval(() => {}, 1000));
    };
    await observeGreenhouseQuestions({store, ...JSON.parse(process.argv[2])});
  `;
  const args = { job: b, form: formFor(note), missing: [note.label], profileSha256 };
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, store.root, JSON.stringify(args)]);
  const exit = once(child, 'exit');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await Promise.race([once(child.stdout, 'data'), exit.then(() => { throw Error('Fixture writer exited before acquiring its lock'); })]);
  child.kill('SIGKILL');
  await exit;
  await see(store, c, formFor(note));
  const updated = await readGreenhouseInbox(store);
  assert.equal(updated.savedAnswers.length, 1);
  assert.deepEqual(updated.waitingJobIds, [c.id]);
});
