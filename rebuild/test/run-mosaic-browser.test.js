import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApplicationStore, digest } from '../src/applications.js';
import { campaignProgress } from '../src/campaign.js';

const options = { skip: process.env.MOSAIC_BROWSER_TESTS !== '1', timeout: 45_000 };

test('one dashboard click discovers a role, prepares a packet and brings its public question into the inbox in manual mode', options, async () => {
  const { chromium } = await import('playwright');
  const home = await mkdtemp(path.join(tmpdir(), 'mosaic-run-browser-'));
  const store = new ApplicationStore(home);
  let child, browser;
  try {
    const profile = { verified: true, facts: { fullName: 'Example Person', email: 'example@example.invalid' } };
    const policy = { enabled: false, submissionMode: 'manual', verifiedProfileSha256: digest(profile) };
    const worker = { enabled: false, maxInspections: 1 };
    const completedPosting = 'https://job-boards.greenhouse.io/example-studio/jobs/299';
    const historical = [{ id: 'previous-application', company: 'Example Studio', title: 'Director of Product, Design',
      status: 'submitted', url: completedPosting, createdAt: '2026-01-02T00:00:00Z',
      receipt: { confirmed: true, posting: completedPosting + '/confirmation', text: 'Thank you for applying' } }];
    const campaign = { enabled: true, targetConfirmed: 1, since: '2026-01-01T00:00:00Z' };
    await store.write('application-ledger.json', historical);
    await store.write('campaign.json', campaign);
    assert.equal((await campaignProgress({ home })).complete, true);
    await store.write('application-profile.json', profile);
    await store.write('application-policy.json', policy);
    await store.write('worker.json', worker);
    await store.write('connections.json', { boards: [{ type: 'greenhouse', slug: 'example-studio', company: 'Example Studio' }] });
    await store.write('search.json', { titleLevels: ['director'], titleFields: ['product'], localCities: [], minAnnualBaseUsd: 190000 });

    child = fork(new URL('./helpers/run-mosaic-fixture.js', import.meta.url), ['serve'], {
      silent: true, env: { ...process.env, ROLEMOSAIC_HOME: home, PORT: '0' },
    });
    const outbound = [];
    child.on('message', event => outbound.push(event));
    const [banner] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(8000) });
    const base = String(banner).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(base, 'Server should advertise its private loopback address');

    browser = await chromium.launch({ headless: true, channel: process.env.MOSAIC_TEST_CHANNEL || undefined, chromiumSandbox: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const external = [], actions = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) {
        external.push(url.href);
        return route.abort('blockedbyclient');
      }
      if (route.request().method() === 'POST') actions.push(url.pathname);
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/#inbox');
    const run = page.getByRole('button', { name: 'Run Mosaic', exact: true });
    await run.waitFor();
    assert.deepEqual(outbound, []);
    const [started] = await Promise.all([
      page.waitForResponse(response => response.url() === base + '/api/worker/run'),
      run.click(),
    ]);
    assert.equal(started.status(), 202);
    const busy = page.locator('#workerRun:disabled');
    await busy.waitFor();
    // A second click while the request is in progress must never enqueue another run.
    await busy.evaluate(button => button.click());
    child.send('finishDiscovery');

    await page.locator('#runStatus').filter({ hasText: /Run finished/i }).waitFor();
    await page.getByRole('group', { name: 'What is your notice period?', exact: true }).waitFor();
    assert.equal(await run.isEnabled(), true);
    assert.deepEqual(actions, ['/api/worker/run']);
    assert.deepEqual(outbound, [
      { kind: 'request', url: 'https://boards-api.greenhouse.io/v1/boards/example-studio/jobs?content=true',
        method: 'GET', hasBody: false, hasHeaders: false },
      { kind: 'request', url: 'https://boards-api.greenhouse.io/v1/boards/example-studio/jobs/301?pay_transparency=true&questions=true',
        method: 'GET', hasBody: false, hasHeaders: false },
    ]);
    const packets = await store.read('quality-packets.json');
    assert.equal(packets.packets.length, 1);
    assert.equal(packets.packets[0].job.title, 'Director of Product');
    assert.deepEqual(await store.read('application-ledger.json'), historical);
    assert.deepEqual(await store.read('campaign.json'), campaign);
    assert.equal((await campaignProgress({ home })).confirmed, 1);
    assert.deepEqual(await store.read('history.json', []), []);
    assert.deepEqual(await store.read('application-policy.json'), policy);
    assert.deepEqual(await store.read('worker.json'), worker);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  }
});
