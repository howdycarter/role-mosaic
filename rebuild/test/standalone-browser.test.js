import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {ApplicationStore,digest,prepareApplications,approvePackets,runApplications,reconcileApplications} from '../src/applications.js';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';

test('standalone Playwright prepares without transmission, submits once, saves a receipt and reconciles after restart without clicking',{skip:process.env.MOSAIC_BROWSER_TESTS!=='1'},async()=>{
 const {chromium}=await import('playwright');
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-native-')),store=new ApplicationStore(root);
 const context=await chromium.launchPersistentContext(path.join(root,'browser'),{headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
 try{
  const url='https://job-boards.greenhouse.io/example/jobs/123';let navigations=0;
  const html=`<!doctype html><h1>Director of Product</h1><p>Remote - United States</p><p>Annual base salary $200,000 - $250,000 USD per year</p><h2>Apply for this job</h2><form><label for="name">Name*</label><input id="name" required><label for="email">Email*</label><input id="email" type="email" required><label for="resume">Resume</label><input id="resume" type="file"><p id="filename"></p><button>Submit application</button></form><script>document.getElementById('resume').onchange=e=>document.getElementById('filename').textContent=e.target.files[0].name;document.querySelector('form').onsubmit=e=>{e.preventDefault();document.body.innerHTML='<h1>Thank you for applying</h1><p>Your application has been received.</p>'};</script>`;
  await context.route('**/*',async route=>{assert.equal(route.request().url(),url);assert.equal(route.request().method(),'GET');navigations++;await route.fulfill({contentType:'text/html',body:html});});
  const pdf=Buffer.from('%PDF-1.4\nsynthetic'),resume=path.join(root,'own-approved.pdf');await writeFile(resume,pdf);
  const profile={verified:true,facts:{fullName:'Example Person',email:'person@example.invalid',stateCode:'TX'}};
  await store.write('application-profile.json',profile);await store.write('resume-approval.json',{approved:true,path:resume,sha256:digest(pdf)});
  await store.write('connections.json',{resume});await store.write('history.json',[]);
  await store.write('application-policy.json',{enabled:true,maxPerDay:15,dailyBudgetUsd:1,timezone:'America/Chicago',resumeApprovalPath:'resume-approval.json',verifiedProfileSha256:digest(profile)});
  await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:190000,excludeEmployers:[]});
  await store.write('jobs.json',[{id:'native-job',company:'Example',title:'Director of Product',location:'Remote US',url}]);
  const adapter=new PlaywrightApplicationAdapter(context,{home:root});
  const plan=await prepareApplications({home:root,adapter});assert.equal(plan.packets.length,1);
  const page=context.pages().find(p=>p.url()===url);assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#resume').evaluate(e=>e.files.length),0);
  assert.equal((await runApplications({home:root,adapter}))[0].status,'authorization_required');assert.equal(await page.locator('#name').inputValue(),'');
  await approvePackets({home:root,ids:plan.packets.map(p=>p.id)});
  const result=await runApplications({home:root,adapter});assert.equal(result[0].status,'submitted');assert.equal((await store.read('history.json')).length,1);
  assert.equal((await runApplications({home:root,adapter}))[0].status,'duplicate_held');
  // Simulate losing the post-click confirmation response, then a new worker
  // adapter recovering the existing receipt page by posting identity.
  const ledger=await store.read('application-ledger.json');ledger[0].status='submission_unknown';delete ledger[0].receipt;await store.write('application-ledger.json',ledger);
  const restarted=new PlaywrightApplicationAdapter(context,{home:root});
  assert.equal((await reconcileApplications({home:root,adapter:restarted}))[0].status,'submitted');
  assert.equal((await store.read('history.json')).length,1);assert.equal(navigations,1);
 }finally{await context.close();await rm(root,{recursive:true,force:true});}
});

test('native browser refuses an unrecognized required radio widget before applicant fill',{skip:process.env.MOSAIC_BROWSER_TESTS!=='1'},async()=>{
 const {chromium}=await import('playwright');const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-native-hold-'));
 const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true}),context=await browser.newContext();
 try{
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<h1>Director of Product</h1><p>Remote - United States</p><fieldset><legend>Required legal question</legend><label><input type="radio" name="legal" required>Yes</label></fieldset>'}));
  const adapter=new PlaywrightApplicationAdapter(context,{home:root}),inspection=await adapter.inspect({id:'blocked',title:'Director of Product',url:'https://job-boards.greenhouse.io/example/jobs/456'});
  assert.ok(inspection.form.fields.some(f=>f.type==='manual'&&f.required));
 }finally{await browser.close();await rm(root,{recursive:true,force:true});}
});
