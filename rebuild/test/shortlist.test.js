import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectShortlistPosting, researchShortlist } from '../src/shortlist.js';

const search = { titleLevels: ['director'], titleFields: ['engineering'], localCities: [], minAnnualBaseUsd: 150000 };
const job = { id: '1', title: 'Director of Engineering', company: 'Example', status: 'new', location: 'Remote US',
  url: 'https://job-boards.greenhouse.io/example/jobs/123', listingState: 'listed' };
const pay = { min: 160000, max: 200000, currency: 'USD', interval: 'year' };

test('shortlist verifies salary-only holds and never researches a known or no-longer-listed posting', async () => {
  const fresh = { ...job, id: '2', url: job.url.replace('123', '456') };
  const jobs = [job, fresh, { ...job, id: '3', listingState: 'unlisted' }];
  const calls = [];
  const results = await researchShortlist({ jobs, search, history: [], ledger: [{ url: job.url, status: 'submission_unknown' }],
    track: 'engineering', inspect: async j => {
      calls.push(j.id);
      return { posting: j.url, title: j.title, location: j.location, compensation: pay };
    } });
  assert.deepEqual(calls, ['2']);
  assert.equal(results.results[0].passesLiveSearchRules, true);
  assert.equal(jobs[1].compensation, undefined);
  const changed = await researchShortlist({ jobs: [job], search, history: [], ledger: [],
    track: 'engineering', inspect: async () => ({ posting: job.url, title: 'Different role' }) });
  assert.match(changed.results[0].review[0], /need verification/);
});

test('employer-hosted posting must be linked by the same official Greenhouse requisition', async () => {
  const local = { ...job, source: 'greenhouse/example', sourceId: '123', url: 'https://example.invalid/careers?gh_jid=123' };
  const fetcher = posting => async url => {
    assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/example/jobs/123?pay_transparency=true');
    return Response.json({ id: 123, absolute_url: posting, title: local.title, location: { name: local.location } });
  };
  assert.equal((await inspectShortlistPosting(local, fetcher(local.url))).posting, local.url);
  assert.equal((await inspectShortlistPosting(local, fetcher(local.url.replace('https:', 'http:')))).posting, local.url);
  assert.equal(await inspectShortlistPosting(local, fetcher('https://other.invalid/?gh_jid=123')), null);
});
