import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ApplicationStore, approveResume, configureStandingAuthorization, digest,
  prepareApplications, runApplications } from '../src/applications.js';
import { seedQuality } from './helpers/quality-fixture.js';

const before = '2026-11-10T05:59:59.000Z';
const after = '2026-11-10T06:00:01.000Z';

async function midnightFixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'mosaic-quota-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ApplicationStore(home);
  const clock = { time: before };
  const now = () => new Date(clock.time);
  const job = { id: 'test', company: 'Example Studio', title: 'Director of Product',
    location: 'Remote US', url: 'https://job-boards.greenhouse.io/example/jobs/301',
    compensation: { min: 200000, currency: 'USD', interval: 'year' } };
  const profile = { verified: true, facts: { fullName: 'Example Person', email: 'test@example.invalid' } };
  const resume = path.join(home, 'sample.pdf');
  await writeFile(resume, '%PDF-1.4 synthetic');
  await store.write('jobs.json', [job]);
  await store.write('connections.json', { resume });
  await store.write('application-profile.json', profile);
  await store.write('history.json', []);
  await store.write('search.json', { titleLevels: ['director'], titleFields: ['product'], minAnnualBaseUsd: 190000 });
  await store.write('application-policy.json', { enabled: true, submissionMode: 'automatic', maxPerDay: 1,
    dailyBudgetUsd: 1, timezone: 'America/Chicago', resumeApprovalPath: 'resume-approval.json',
    verifiedProfileSha256: digest(profile), automationRiskAcknowledged: true });
  await approveResume({ home, confirm: 'reviewed', now });
  await seedQuality(home, job, resume);
  await configureStandingAuthorization({ home, evidence: 'Synthetic standing authorization', now });
  const form = { fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
    resume: { label: 'Resume' }, submit: { label: 'Submit application' } };
  const dispatches = [];
  const adapter = { transport: 'playwright', estimatedCostUsd: 0,
    inspect: async () => ({ job, form, location: job.location, titleVerified: true, tabId: 'test-tab',
      description: 'Annual base salary $200,000 - $250,000 USD per year' }),
    fill: async () => {}, verify: async () => ({ ok: true }),
    submit: async () => dispatches.push((await store.read('application-ledger.json')).at(-1)),
    confirm: async () => ({ confirmed: true, posting: job.url, text: 'Application received' }) };
  const plan = await prepareApplications({ home, adapter, now });
  assert.equal(plan.packets.length, 1, JSON.stringify(plan.held));
  const run = async resumeAttemptId => (await runApplications({ home, adapter, now, resumeAttemptId }))[0];
  return { clock, store, run, adapter, dispatches };
}

test('a draft crossing Chicago midnight reserves the new submission day before dispatch', async t => {
  const { clock, store, adapter, run, dispatches } = await midnightFixture(t);
  adapter.captureVerificationCheckpoint = async () => { clock.time = after; };
  const result = await run();
  assert.equal(result.status, 'submitted');
  assert.equal(dispatches.length, 1);
  assert.deepEqual([dispatches[0].status, dispatches[0].day, dispatches[0].finalActionAt],
    ['submission_unknown', '2026-11-10', after]);
  assert.equal((await store.read('application-ledger.json'))[0].costDay, '2026-11-09');
});

test('an existing or resumed draft holds when the new day is already full', async t => {
  for (const resumed of [false, true]) await t.test(resumed ? 'resumed' : 'new', async t => {
    const { clock, store, adapter, run, dispatches } = await midnightFixture(t);
    // Historical entries with only a day field must still reserve capacity.
    await store.write('application-ledger.json', [{ id: 'earlier', status: 'submission_unknown', day: '2026-11-10' }]);
    let attemptId;
    if (resumed) {
      adapter.verify = async () => ({ ok: false, reason: 'Synthetic readback hold' });
      attemptId = (await run()).id;
      adapter.verify = async () => ({ ok: true });
    }
    adapter.captureVerificationCheckpoint = async () => { clock.time = after; };
    const held = await run(attemptId);
    assert.equal(held.status, 'held');
    assert.match(held.reason, /daily submission limit/i);
    assert.equal(held.finalActionAt, undefined);
    if (resumed) assert.equal(held.id, attemptId);
    assert.equal((await store.read('application-ledger.json')).length, 2);
    assert.deepEqual(dispatches, []);
  });
});

test('the final reservation uses current imported receipts even on the same day', async t => {
  const { store, adapter, run, dispatches } = await midnightFixture(t);
  await store.write('application-ledger.json', [{ day: '2026-11-08', status: 'submitted' }]);
  adapter.captureVerificationCheckpoint = () => store.write('history.json', [
    { company: 'Other employer', role: 'Other opening', status: 'submitted', date: '2026-11-09' }
  ]);
  assert.equal((await run()).status, 'held');
  assert.deepEqual(dispatches, []);
});

test('a recorded final action takes precedence over a historical attempt creation day', async t => {
  const { clock, store, run, dispatches } = await midnightFixture(t);
  clock.time = after;
  await store.write('application-ledger.json', [{ id: 'older', day: '2026-11-09', status: 'submitted',
    finalActionAt: after, createdAt: before }]);
  assert.equal((await run()).status, 'daily_limit');
  assert.deepEqual(dispatches, []);
});
