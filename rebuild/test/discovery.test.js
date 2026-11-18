import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApplicationStore } from '../src/applications.js';
import { scanBoards } from '../src/discovery.js';
import { discoveryPlist } from '../../scripts/daily-discovery.mjs';

const board = slug => ({ type: 'greenhouse', slug, company: slug });
const listing = (slug, id) => ({ id, title: 'Director', absolute_url: 'https://example.invalid/' + slug + '/' + id });
async function fixture(t, slugs) {
  const home = await mkdtemp(path.join(tmpdir(), 'discovery-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new ApplicationStore(home);
  await store.write('connections.json', { boards: slugs.map(board) });
  return store;
}
const ok = jobs => Response.json({ jobs });

test('an empty successful board marks only its omitted jobs unlisted; failed sources keep their observations; reappearance keeps notes and receipts', async t => {
  const store = await fixture(t, ['alpha', 'bravo', 'alpha']);
  const first = await scanBoards({ store, fetcher: async (url, init) => {
    const target = new URL(url);
    assert.equal(target.host, 'boards-api.greenhouse.io');
    assert.equal(init.body, undefined);
    assert.equal(init.method || 'GET', 'GET');
    const slug = target.pathname.split('/')[3];
    return ok([listing(slug, 1)]);
  } });
  assert.deepEqual([first.status, first.boards, first.added, first.saved], ['ok', 2, 2, 2]);
  const original = await store.read('jobs.json', []);
  const alpha = original.find(row => row.company === 'alpha');
  Object.assign(alpha, { status: 'interview', note: 'private note', receiptId: 'receipt' });
  await store.write('jobs.json', original);
  const partial = await scanBoards({ store, fetcher: async url => url.includes('/alpha/') ? ok([]) : new Response('', { status: 503 }) });
  assert.deepEqual([partial.status, partial.fetched, partial.unlisted, partial.lastFullScanAt], ['partial', 0, 1, first.at]);
  const latest = await store.read('jobs.json', []);
  assert.equal(latest.find(row => row.company === 'alpha').listingState, 'unlisted');
  assert.equal(latest.find(row => row.company === 'bravo').listingState, 'listed');
  const outage = await scanBoards({ store, fetcher: async () => new Response('', { status: 503 }) });
  assert.equal(outage.status, 'failed');
  assert.deepEqual(await store.read('jobs.json', []), latest);
  assert.equal((await store.read('discovery-state.json')).lastFullScanAt, first.at);
  await scanBoards({ store, fetcher: async url => url.includes('/alpha/') ? ok([listing('alpha', 1)]) : ok([]) });
  const reopened = (await store.read('jobs.json')).find(row => row.id === alpha.id);
  assert.deepEqual([reopened.listingState, reopened.unlistedAt, reopened.firstSeen, reopened.status, reopened.note, reopened.receiptId], ['listed', undefined, alpha.firstSeen, 'interview', 'private note', 'receipt']);
  assert.deepEqual((await readdir(store.root)).sort(), ['connections.json', 'discovery-state.json', 'jobs.json']);
});

test('malformed and explicitly incomplete snapshots retain existing board membership', async t => {
  const store = await fixture(t, ['alpha']);
  const active = listing('alpha', 1);
  const first = await scanBoards({ store, fetcher: async () => ok([active]) });
  for (const body of [
    { jobs: [{ ...active, absolute_url: '' }], meta: { total: 1 } },
    { jobs: [], meta: { total: 1 } },
    { jobs: [{ ...active, absolute_url: 'https://:' }] },
  ]) {
    const result = await scanBoards({ store, fetcher: async () => Response.json(body) });
    assert.equal(result.status, 'failed');
    assert.equal(result.lastFullScanAt, first.at);
    assert.equal((await store.read('jobs.json'))[0].listingState, 'listed');
  }
});

test('an older concurrent discovery cannot overwrite a newer scan', async t => {
  const store = await fixture(t, ['alpha']);
  let begin, release;
  const pending = new Promise(resolve => { begin = resolve; });
  const older = scanBoards({ store, now: () => new Date('2026-01-01'), fetcher: () => new Promise(resolve => { release = resolve; begin(); }) });
  await pending;
  await scanBoards({ store, now: () => new Date('2026-01-02'), fetcher: async () => ok([listing('alpha', 2)]) });
  release(ok([listing('alpha', 1)]));
  assert.equal((await older).status, 'superseded');
  assert.deepEqual((await store.read('jobs.json')).map(row => row.sourceId), ['2']);
});

test('a preexisting application lock protects saved jobs during discovery', async t => {
  const store = await fixture(t, ['alpha']);
  await store.lock(async () => {
    await assert.rejects(scanBoards({ store, fetcher: async () => ok([listing('alpha', 1)]) }), /owns this workspace/);
  });
  assert.equal(await store.read('jobs.json', null), null);
});

test('calendar schedule invokes only the pinned discovery program once at the chosen local time', () => {
  const args = { runtime: '/tmp/runtime & fixture/rebuild', home: '/tmp/private', node: '/tmp/node', time: '09:07' };
  const body = discoveryPlist(args);
  assert.match(body, /<string>\/tmp\/runtime &amp; fixture\/rebuild\/src\/discovery\.js<\/string>/);
  assert.match(body, /<key>Hour<\/key><integer>9<\/integer><key>Minute<\/key><integer>7<\/integer>/);
  assert.doesNotMatch(body, /RunAtLoad|KeepAlive|worker\.js|cli\.js|server\.js/);
  assert.throws(() => discoveryPlist({ ...args, time: '24:00' }), /local time/);
  assert.throws(() => discoveryPlist({ ...args, runtime: '../runtime' }), /absolute/);
});
