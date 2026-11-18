// Synthetic Greenhouse network for a real local server and Playwright worker.
// The child installs this before importing the server. No production switch is used.
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PlaywrightApplicationAdapter } from '../../src/playwright-adapter.js';

export const notice = 'What is your notice period?';
export const priorEmployment = 'Have you ever worked for this company?';
export const content = 'Annual base salary $200,000 - $250,000 USD per year';
export const location = 'Remote - United States';
export const postings = [
  { id: '101', board: 'example-alpha', team: 'Growth' },
  { id: '102', board: 'example-alpha', team: 'Payments', question: notice },
  { id: '103', board: 'example-bravo', team: 'Research', question: notice },
  { id: '104', board: 'example-alpha', team: 'Delivery', question: priorEmployment },
  { id: '105', board: 'example-alpha', team: 'Platform', question: priorEmployment },
  { id: '106', board: 'example-bravo', team: 'Catalog', question: priorEmployment },
  { id: '107', board: 'example-bravo', team: 'Support' },
  { id: '108', board: 'example-bravo', team: 'Insights', question: notice },
].map(row => ({ ...row, title: 'Director of Product, '+row.team,
  url: 'https://job-boards.greenhouse.io/'+row.board+'/jobs/'+row.id }));

function apiRow(p) {
  return { id: Number(p.id), title: p.title, absolute_url: p.url, location: { name: location }, content };
}

function form(p) {
  const field = p.question === priorEmployment
    ? '<select id="question" required><option value="">Choose an option</option><option>Yes</option><option>No</option></select>'
    : '<input id="question" required>';
  return `<!doctype html><title>${p.title}</title><h1>${p.title}</h1><p>${location}</p><p>${content}</p>
    <h2>Apply for this job</h2><form>
    <label for="name">Name*</label><input id="name" required>
    ${p.question ? '<label for="question">'+p.question+'</label>'+field : ''}
    <label for="resume">Resume</label><input id="resume" type="file"><p id="filename"></p>
    <button>Submit application</button></form>
    <script>
      document.querySelector('#resume').onchange = e => {
        document.querySelector('#filename').textContent = e.target.files[0].name;
      };
      document.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const response = await fetch(location.href, {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({name:document.querySelector('#name').value, answer:document.querySelector('#question')?.value,
            resume:document.querySelector('#resume').files[0]?.name})});
        if (response.ok) document.body.innerHTML = '<h1>Thank you for applying</h1><p>Your application has been received.</p>';
      };
    </script>`;
}

export function installFixture(home) {
  const log = event => appendFile(path.join(home, 'fixture-events.jsonl'), JSON.stringify(event)+'\n');
  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(input);
    const match = /^\/v1\/boards\/(example-alpha|example-bravo)\/jobs(?:\/(\d+))?$/.exec(url.pathname);
    if (url.origin !== 'https://boards-api.greenhouse.io' || !match || (opts.method || 'GET') !== 'GET') {
      await log({kind:'blocked-network',url:url.href});
      throw Error('Unexpected fixture API request');
    }
    const ids = JSON.parse(await readFile(path.join(home, 'fixture-available.json'), 'utf8'));
    const rows = postings.filter(p => ids.includes(p.id) && p.board === match[1]).map(apiRow);
    if (!match[2]) return Response.json({jobs:rows, meta:{total:rows.length}});
    const row = rows.find(j => String(j.id) === match[2]);
    return row ? Response.json(row) : new Response(null, {status:404});
  };

  const launch = PlaywrightApplicationAdapter.launch;
  let browser;
  process.once('SIGTERM', async () => { try { await browser?.close(); } finally { process.exit(0); } });
  PlaywrightApplicationAdapter.launch = async config => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({headless:true, channel:process.env.MOSAIC_TEST_CHANNEL || undefined, chromiumSandbox:true});
    const context = await browser.newContext({serviceWorkers:'block'});
    context.setDefaultTimeout(6000);
    await context.route('**/*', async route => {
      const request = route.request();
      const posting = postings.find(p => p.url === request.url());
      if (!posting || !['GET','POST'].includes(request.method())) {
        await log({kind:'blocked-network', url:request.url()});
        return route.abort('blockedbyclient');
      }
      if (request.method() === 'POST') {
        await log({kind:'submit', id:posting.id, ...request.postDataJSON()});
        return route.fulfill({json:{received:true}});
      }
      await log({kind:'inspect', id:posting.id});
      return route.fulfill({contentType:'text/html',body:form(posting)});
    });
    return launch.call(PlaywrightApplicationAdapter, {...config, context});
  };
}
