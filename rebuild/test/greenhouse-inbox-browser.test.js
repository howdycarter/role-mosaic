import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ApplicationStore, digest, postingKey } from '../src/applications.js';
import { identity } from '../src/core.js';
import { seedQuality } from './helpers/quality-fixture.js';
import { postings, content, location, notice, priorEmployment, consentChoices, consentPostings } from './helpers/greenhouse-inbox-fixture.js';

const rebuild = fileURLToPath(new URL('..', import.meta.url));
const fixtureModule = new URL('./helpers/greenhouse-inbox-fixture.js', import.meta.url).href;
const serverModule = new URL('../src/server.js', import.meta.url).href;
const makeJob = p => ({id:identity({url:p.url}), source:'greenhouse/'+p.board, company:p.board, url:p.url, title:p.title, location, description:content});
const testOptions = {skip:process.env.MOSAIC_BROWSER_TESTS !== '1', timeout:100_000};

async function startServer(home) {
  const script = `import {installFixture} from ${JSON.stringify(fixtureModule)}; installFixture(process.env.ROLEMOSAIC_HOME); await import(${JSON.stringify(serverModule)});`;
  const child = spawn(process.execPath, ['--input-type=module','--eval',script], {
    cwd:rebuild, env:{...process.env, ROLEMOSAIC_HOME:home, PORT:'0'}, stdio:['ignore','pipe','pipe'],
  });
  let stdout = '', stderr = '';
  child.stderr.on('data', b=>{stderr+=b});
  const base = await new Promise((resolve,reject) => {
    child.stdout.on('data', data => {
      stdout += data;
      const address = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (address) resolve(address[0]);
    });
    child.once('error',reject);
    child.once('exit',()=>reject(Error('Server stopped: '+stderr)));
  });
  return {
    base,
    async close() {
      if (child.exitCode !== null || child.signalCode) return;
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    },
  };
}

async function seedWorkspace(home, store) {
  const resume = path.join(home,'approved.pdf'), pdf=Buffer.from('%PDF-1.4\nLocal test only');
  await writeFile(resume,pdf);
  const profile = { verified:true, facts:{fullName:'Example Applicant',email:'applicant@example.invalid',stateCode:'TX'} };
  await store.write('application-profile.json',profile);
  await store.write('resume-approval.json',{approved:true,path:resume,sha256:digest(pdf)});
  const boards = ['example-alpha','example-bravo'].map(slug=>({type:'greenhouse',slug,company:slug}));
  await store.write('connections.json',{resume,boards});
  await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:150000});
  await store.write('application-policy.json',{enabled:false,submissionMode:'manual',automationRiskAcknowledged:false,requireQualityReview:true,
    maxPerDay:15,dailyBudgetUsd:1,timezone:'UTC',resumeApprovalPath:'resume-approval.json',verifiedProfileSha256:digest(profile)});
  await store.write('worker.json',{enabled:false,headless:true,maxInspections:15,autoSubmitApproved:true});
  await store.write('history.json',[]);
  for(const posting of postings) await seedQuality(home,makeJob(posting),resume);
  await store.write('fixture-available.json',postings.filter(p=>p.id!=='108').map(p=>p.id));
  const uncertain=makeJob(postings.find(p=>p.id==='107'));
  await store.write('application-ledger.json',[{id:'original-uncertain',jobId:uncertain.id,company:uncertain.company,title:uncertain.title,
    url:uncertain.url,postingKey:postingKey(uncertain.url),status:'submission_unknown',createdAt:new Date().toISOString()}]);
  // Start with the same disabled legacy policy as a workspace moving from manual to automatic.
}

async function waitForIdle(base, store, expectedReceipts, previousStart) {
  const deadline = Date.now() + 18_000;
  let status, ledger;
  while (Date.now() < deadline) {
    const health = await (await fetch(base + '/api/health')).json();
    status = await store.read('worker-state.json', {});
    ledger = await store.read('application-ledger.json', []);
    if (status.state === 'error') break;
    if (!health.workerRunning && status.state === 'idle' && status.startedAt !== previousStart &&
        ledger.filter(a => a.status === 'submitted').length === expectedReceipts) return;
    await delay(70);
  }
  assert.fail(JSON.stringify({
    worker: status, attempts: ledger.map(a => ({title:a.title, status:a.status, reason:a.reason})),
    holds: (await store.read('application-plan.json', {})).held,
  }));
}

test('authorizing one current consent card applies only to its selected Greenhouse posting in Chrome', testOptions, async t=>{
  const {chromium}=await import('playwright');
  const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-permission-browser-')),store=new ApplicationStore(home);
  t.after(()=>rm(home,{recursive:true,force:true}));
  await seedWorkspace(home,store);
  const priorUrl='https://job-boards.greenhouse.io/example-alpha/jobs/100';
  const profile=await store.read('application-profile.json');
  profile.answers=consentChoices.map(({id,...choice})=>({
    question:choice.label,answer:choice.answer,...(choice.kind?{kind:choice.kind}:{}),
    verified:true,scopePostingKey:postingKey(priorUrl),
  }));
  await store.write('application-profile.json',profile);
  const policy=await store.read('application-policy.json');
  await store.write('application-policy.json',{...policy,verifiedProfileSha256:digest(profile)});
  await store.write('application-ledger.json',[{id:'past',jobId:'prior-job',company:'example-alpha',title:'Commercial Engineer',
    url:priorUrl,postingKey:postingKey(priorUrl),status:'submitted',createdAt:new Date().toISOString()}]);
  for(const p of consentPostings)await seedQuality(home,makeJob(p),path.join(home,'approved.pdf'));
  await store.write('fixture-available.json',consentPostings.map(p=>p.id));
  const server=await startServer(home);
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
    const dashboard=await browser.newContext({serviceWorkers:'block'});
    const errors=[],external=[];
    await dashboard.route('**/*',route=>{
      if(new URL(route.request().url()).origin===server.base)return route.continue();
      external.push(route.request().url());return route.abort('blockedbyclient');
    });
    const page=await dashboard.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.base);
    await page.getByText('Experimental automatic submission',{exact:true}).click();
    await page.locator('#automaticTrack').selectOption('product');
    await page.locator('#automationRisk').check();
    const enabled=page.waitForResponse(r=>r.url().endsWith('/api/automatic-submissions'));
    await page.locator('#automaticEnable').click();assert.equal((await enabled).status(),200);
    const run=page.waitForResponse(r=>r.url().endsWith('/api/worker/run'));
    await page.locator('#workerRun').click();assert.equal((await run).status(),202);
    await waitForIdle(server.base,store,1);
    const accessLog=async()=>(await readFile(path.join(home,'fixture-events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const before=await accessLog();
    assert.deepEqual(before.filter(e=>e.kind==='submit'),[]);
    await page.reload();
    const [target,other]=consentPostings;
    const card=p=>page.getByRole('group',{name:p.board+' · '+p.title,exact:true});
    await card(other).getByRole('button',{name:'Authorize these answers for this application'}).waitFor();
    const selected=card(target);
    for(const choice of consentChoices){
      await selected.getByText(choice.label,{exact:true}).waitFor();
      await selected.getByText(choice.id==='data'?'Check the consent box':choice.answer,{exact:true}).waitFor();
    }
    assert.equal(await selected.getByRole('link').getAttribute('href'),'https://example.invalid/candidate-policy');
    const beforeStart=(await store.read('worker-state.json')).startedAt;
    const decision=page.waitForResponse(r=>r.url().endsWith('/api/inbox/posting-permission'));
    await selected.getByRole('button',{name:'Authorize these answers for this application'}).click();
    const response=await decision;assert.ok(response.ok(),await response.text());
    await waitForIdle(server.base,store,2,beforeStart);
    const after=await accessLog(),approvedTrack=(await store.read('resume-registry.json')).variants.product;
    assert.deepEqual(after.filter(e=>e.kind==='submit'),[{kind:'submit',id:target.id,name:'Example Applicant',
      resume:path.basename(approvedTrack.path),choices:{privacy:'I acknowledge',ethnicity:'I decline to answer',data:true}}]);
    assert.ok(after.slice(before.length).every(e=>e.id===target.id));
    const ledger=await store.read('application-ledger.json');
    const sent=ledger.filter(a=>a.id!=='past');
    assert.equal(sent.length,1);assert.equal(sent[0].jobId,makeJob(target).id);
    assert.equal(sent[0].status,'submitted');assert.equal(sent[0].receipt?.confirmed,true);
    assert.deepEqual(await store.read('application-profile.json'),profile);
    await page.reload();
    await card(other).getByRole('button',{name:'Authorize these answers for this application'}).waitFor();
    assert.equal(await card(target).count(),0);
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    assert.ok(!after.some(e=>e.kind==='blocked-network'));
  } finally {await browser?.close();await server.close();}
});

test('Greenhouse decisions continue the correct forms through Chrome, scope reuse and service restart', testOptions, async () => {
  const {chromium}=await import('playwright');
  const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-inbox-browser-')), store=new ApplicationStore(home);
  let server, browser;
  try {
    await seedWorkspace(home,store);
    server=await startServer(home);
    browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
    const dashboard = await browser.newContext({serviceWorkers:'block'});
    const page = await dashboard.newPage();
    const unexpected = [], pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await dashboard.route('**/*', route => {
      if (new URL(route.request().url()).origin === server.base) return route.continue();
      unexpected.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    page.setDefaultTimeout(8000);
    async function events() {
      const log = await readFile(path.join(home, 'fixture-events.jsonl'), 'utf8');
      return log.trim().split('\n').map(line => JSON.parse(line));
    }
    const submitted = async () => (await events()).filter(e => e.kind === 'submit');
    async function runWave(expectedReceipts) {
      await page.waitForFunction(() => typeof document.getElementById('workerRun')?.onclick === 'function');
      const {startedAt} = await store.read('worker-state.json', {});
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/worker/run')),
        page.locator('#workerRun').click(),
      ]);
      assert.equal(response.status(),202);
      await waitForIdle(server.base,store,expectedReceipts,startedAt);
      await page.reload();
    }
    async function answer(label, scope, value, jobId, expectedReceipts) {
      let group = page.getByRole('group', {name:label, exact:true});
      if (jobId) {
        group = group.filter({has:page.locator('option[value="'+jobId+'"]')});
        await group.getByRole('combobox',{name:/^Application/}).selectOption(jobId);
      }
      await group.getByRole('combobox',{name:/^Use this answer for/}).selectOption(scope);
      const input = group.getByLabel(/^Your answer/);
      if (await input.evaluate(e => e.tagName === 'SELECT')) await input.selectOption({label:value});
      else await input.fill(value);
      const [reply] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/inbox/answer')),
        group.getByRole('button',{name:'Save answer and continue'}).click(),
      ]);
      assert.ok(reply.ok(), await reply.text());
      if (expectedReceipts !== null) await waitForIdle(server.base,store,expectedReceipts);
      await page.reload();
    }

    await page.goto(server.base);
    await page.getByText('Experimental automatic submission',{exact:true}).click();
    await page.locator('#automaticTrack').selectOption('product');
    await page.locator('#automationRisk').check();
    const [activation]=await Promise.all([
      page.waitForResponse(r=>r.url().endsWith('/api/automatic-submissions')),page.locator('#automaticEnable').click(),
    ]);
    assert.equal(activation.status(),200,await activation.text());
    const armed=await store.read('application-policy.json');
    assert.equal(armed.standingAuthorization.resumeTrack,'product');
    assert.equal(armed.standingAuthorization.maxPerDay,15);
    assert.equal((await store.read('application-ledger.json')).filter(a=>a.status==='submitted').length,0);
    await assert.rejects(readFile(path.join(home,'fixture-events.jsonl')),{code:'ENOENT'});
    assert.equal((await store.read('worker.json')).enabled,false);
    await page.reload();
    await page.getByText('Automatic applications',{exact:true}).waitFor();
    await runWave(1);
    assert.deepEqual((await submitted()).map(e=>e.id),['101']);
    assert.ok((await (await fetch(server.base+'/api/inbox')).json()).items.some(i=>i.label===notice&&i.postings.length===2));
    await server.close();server=await startServer(home);
    await page.goto(server.base);
    await page.getByRole('heading',{name:'Needs your input'}).waitFor();
    await answer(notice,'future','Two weeks',null,3);
    assert.deepEqual((await submitted()).filter(r=>r.answer==='Two weeks').map(r=>r.id).sort(),['102','103']);

    const alphaId=makeJob(postings.find(p=>p.id==='104')).id;
    await answer(priorEmployment,'employer','No',alphaId,5);
    assert.deepEqual((await submitted()).filter(r=>r.answer==='No').map(r=>r.id).sort(),['104','105']);
    const inbox=await (await fetch(server.base+'/api/inbox')).json();
    assert.deepEqual(inbox.items.find(i=>i.label===priorEmployment).postings.map(p=>p.jobId),[makeJob(postings.find(p=>p.id==='106')).id]);

    await server.close(); server=await startServer(home);
    await store.write('fixture-available.json',postings.map(p=>p.id));  // A later scan discovers the previously unseen form.
    await page.goto(server.base);await runWave(6);
    await runWave(6);
    const sent=await submitted();
    assert.deepEqual(sent.map(r=>r.id).sort(),['101','102','103','104','105','108']);
    assert.equal(sent.find(r=>r.id==='108').answer,'Two weeks');
    const approvedTrack=(await store.read('resume-registry.json')).variants.product;
    assert.ok(sent.every(r=>r.name==='Example Applicant' && r.resume===path.basename(approvedTrack.path)));
    assert.equal((await store.read('history.json')).length,6);
    const ledger=await store.read('application-ledger.json');
    assert.equal(ledger.filter(a=>a.status==='submitted'&&a.receipt?.confirmed).length,6);
    assert.equal(ledger.find(a=>a.id==='original-uncertain').status,'submission_unknown');
    assert.ok(!(await events()).some(r=>r.id==='107'||r.kind==='blocked-network'));
    assert.deepEqual(unexpected,[]);
    assert.equal((await store.read('worker.json')).enabled,false);
    // Answering in manual mode can update local knowledge without navigating the worker browser.
    await page.getByText('Experimental automatic submission',{exact:true}).click();
    const switched=page.waitForResponse(r=>r.url().endsWith('/api/submission-mode'));
    await page.locator('#automaticDisable').click();
    assert.equal((await switched).status(),200);
    await page.reload();
    const beforeManual=await events();
    await answer(priorEmployment,'posting','Yes',null,null);
    assert.deepEqual(await events(),beforeManual);
    assert.equal((await store.read('application-policy.json')).submissionMode,'manual');
    assert.equal((await store.read('worker.json')).enabled,false);
    assert.equal((await store.read('application-ledger.json')).filter(a=>a.status==='submitted').length,6);
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(pageErrors,[]);
  } finally {
    await browser?.close();await server?.close();await rm(home,{recursive:true,force:true});
  }
});

test('Ashby native button and radio answers render as exact choices and survive a fresh inspection',testOptions,async t=>{
  const {chromium}=await import('playwright');
  const {inspectAshbyGroups}=await import('../src/ashby-form-groups.js');
  const {PlaywrightApplicationAdapter}=await import('../src/playwright-adapter.js');
  const {observeGreenhouseQuestions,readGreenhouseAnswers,greenhouseAnswerFor}=await import('../src/greenhouse-inbox.js');
  const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-ashby-inbox-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new ApplicationStore(home);
  await seedWorkspace(home,store);
  const url='https://jobs.ashbyhq.com/test-board/12345678-1234-1234-1234-123456789012';
  const job={id:identity({url}),url,title:'Test engineering role',company:'Example',status:'new',listingState:'listed'};
  await store.write('jobs.json',[job]);
  const profileSha256=digest(await store.read('application-profile.json'));
  const server=await startServer(home);
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
    const page=await browser.newPage();
    const formPage=await browser.newPage();
    await formPage.route('**/*', route => route.fulfill({contentType:'text/html',body:`
      <div class="ashby-application-form-field-entry" data-field-path="travel">
        <label class="required">Can you travel quarterly?</label><p>At a customer location.</p>
        <button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Yes</button><button aria-pressed="false">No</button></div>
      <fieldset class="ashby-application-form-input-radio-group"><label class="ashby-application-form-question-title required" for="tenure">Engineering tenure?</label>
        <input type="radio" id="first"><label for="first">0–5 years</label>
        <input type="radio" id="second"><label for="second">6+ years</label></fieldset>
      <div class="ashby-application-form-field-entry" data-field-path="terms"><label class="required">Please select</label>
        <p>This is consent to the processing of personal information.</p><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div>`}));
    await formPage.goto(url+'/application');
    const fields=await formPage.evaluate(inspectAshbyGroups);
    assert.deepEqual(fields.map(f=>f.type),['button-choice','button-choice','radio-choice']);
    await observeGreenhouseQuestions({store,job,form:{fields},missing:fields.map(f=>f.label),profileSha256,channel:'manual'});
    await page.goto(server.base);
    await page.getByRole('group',{name:'Can you travel quarterly?'}).waitFor();
    for(const [label,answer] of [['Can you travel quarterly?','Yes'],['Engineering tenure?','6+ years']]){
      const group=page.getByRole('group',{name:label,exact:true}),choice=group.getByRole('combobox',{name:'Your answer'});
      await choice.selectOption({label:answer});
      const result=page.waitForResponse(r=>r.url().endsWith('/api/inbox/answer'));
      await group.getByRole('button',{name:'Save answer and continue'}).click();
      assert.equal((await result).status(),200);
    }
    assert.equal(await page.getByRole('group',{name:'Please select'}).count(),0);
    const state=await readGreenhouseAnswers(store),fresh=await formPage.evaluate(inspectAshbyGroups);
    const values=fresh.map(field=>greenhouseAnswerFor(state,{job,field,form:{fields:fresh},profileSha256}));
    assert.deepEqual(values,['Yes',undefined,'6+ years']);
    const adapter=new PlaywrightApplicationAdapter(formPage.context(),{home});
    const inspection={tab:adapter.nativeTabs.wrap(formPage),job,form:{fields:fresh,resume:{attached:true,label:'Test résumé'}}};
    const actions=fresh.flatMap((field,i)=>values[i]?[{field,value:values[i]}]:[]);
    await adapter.fill(inspection,actions,path.join(home,'approved.pdf'));
    assert.deepEqual((await formPage.evaluate(inspectAshbyGroups)).map(field=>field.value),['Yes','','6+ years']);
    assert.deepEqual(state.permissions||[],[]);
  }finally{await browser?.close();await server.close();}
});
