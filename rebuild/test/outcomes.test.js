import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationStore } from '../src/applications.js';
import { campaignProgress } from '../src/campaign.js';
import { createHistoryLookup, historyMatch } from '../src/core.js';
import { confirmedReceipt, recordOutcome, summarizeOutcomes } from '../src/outcomes.js';

const now = new Date('2026-05-01T12:00:00Z');
function attempt(id, date = '2026-03-15') {
  const url = 'https://job-boards.greenhouse.io/example/jobs/' + id;
  return { id: String(id), url, status: 'submitted', createdAt: '2026-01-01T00:00:00Z',
    receipt: { confirmed: true, posting: url + '/confirmation', confirmationText: 'Application received',
      verifiedAt: date + 'T12:00:00Z' } };
}
async function workspace(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'mosaic-outcome-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { home, store: new ApplicationStore(home) };
}

test('campaign uses the receipt time and accepts the manual receipt format', async t => {
  const { home, store } = await workspace(t);
  await store.write('campaign.json', { enabled: true, targetConfirmed: 15, since: '2026-03-01T00:00:00Z' });
  await store.write('application-ledger.json', [attempt(1), attempt(1), { ...attempt(2), url: 'invalid' }]);
  assert.equal((await campaignProgress({ home })).confirmed, 1);
});

test('outcomes retain separate stages, prior contact, missing receipts and immature cohorts', async t => {
  const { home, store } = await workspace(t);
  const ledger = [attempt(1), attempt(1), attempt(2), attempt(3), attempt(4, '2026-04-30'),
    { ...attempt(5), status: 'submission_unknown' }, { ...attempt(1), status: 'submission_unknown' },
    { ...attempt(6), receipt: attempt(7).receipt }];
  await store.write('application-ledger.json', ledger);
  const input = { attempt: '1', date: '2026-03-20', stage: 'screen-invite', reference: 'message-one' };
  assert.equal((await recordOutcome(home, input, now)).recorded, true);
  assert.equal((await recordOutcome(home, input, now)).recorded, false);
  await recordOutcome(home, { ...input, stage: 'rejected', date: '2026-04-02' }, now);
  await recordOutcome(home, { ...input, attempt: '2', date: '2026-04-14' }, now); // day 31
  await assert.rejects(recordOutcome(home, { ...input, date: '2026-03-14', attempt: '3' }, now), /predates/);
  await recordOutcome(home, { ...input, date: '2026-03-14', attempt: '3', attribution: 'prior-contact' }, now);
  await assert.rejects(recordOutcome(home, { ...input, attempt: '6' }, now), /confirmed/);
  await assert.rejects(recordOutcome(home, { ...input, date: '2026-02-30' }, now), /valid UTC/);
  const result = summarizeOutcomes(ledger, await store.read('application-outcomes.json'), { now });
  assert.deepEqual(result.first30Days, { mature: 2, advanced: 1, pending: 1, recordedProgressionRate: 0.5 });
  assert.equal(result.confirmed, 4);
  assert.equal(result.unverifiedSubmitted, 1);
  assert.equal(result.unresolved, 1);
  assert.equal(result.noRecordedOutcome, 1);
  assert.equal(result.priorContact, 1);
  assert.equal(result.observed['screen-invite'], 3);
  assert.equal(result.observed.rejected, 1);
  assert.equal(summarizeOutcomes([], [], { now }).first30Days.recordedProgressionRate, null);
});

test('indexed duplicate checks preserve first-row precedence and tolerate old malformed URLs', () => {
  const rows = [
    { company: 'EXAMPLE inc.', role: 'Lead, Engineering', posting: 'not a URL' },
    { posting: 'https://example.com/jobs/one/?source=feed' }, { company: '', role: '' },
  ];
  const lookup = createHistoryLookup(rows);
  for (const [job, expected] of [
    [{ company: 'Example inc', title: 'Lead Engineering', url: 'https://example.com/jobs/one' }, rows[0]],
    [{ company: 'Other', url: 'https://example.com/jobs/one?utm_medium=feed' }, rows[1]],
    [{ url: 'invalid' }, null],
  ]) {
    assert.equal(lookup(job), expected);
    assert.equal(historyMatch(job, rows), expected);
  }
});

test('receipt reporting recognizes both official Greenhouse hosts for the identical employer and job', () => {
  const original = attempt(4);
  const url = original.url.replace('job-boards.', 'boards.');
  assert.ok(confirmedReceipt({ ...original, url }));
  for (const bad of [url.replace('/example/', '/another/'), url.replace('boards.', 'spoof.'), url.replace('/4', '/9?gh_jid=4'), original.url.replace('/example/', '/another/'), original.url.replace('/4', '/9?gh_jid=4')]) {
    assert.equal(confirmedReceipt({ ...original, url: bad }), null);
  }
});
