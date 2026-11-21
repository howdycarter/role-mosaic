import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApplicationStore, configureStandingAuthorization, digest, meetsContributorRule } from '../src/applications.js';
import { inboxRoleReview, saveInboxRoleReview } from '../src/inbox-role-review.js';
import { readDecisionInbox } from '../src/decision-inbox.js';
import { greenhouseAnswerFor, observeGreenhouseQuestions, readGreenhouseAnswers, answerGreenhouseQuestion } from '../src/greenhouse-inbox.js';
import { seedQuality } from './helpers/quality-fixture.js';

const posting={id:'role',title:'Senior Forward Deployed Engineer',company:'Example',location:'Remote US',
  description:'You must deliver production software.',url:'https://jobs.ashbyhq.com/example/00000000-0000-4000-a000-000000000123'};
const profile={verified:true,facts:{fullName:'Example User',email:'example@example.invalid'}};
async function fixture(t){
  const home=await mkdtemp(path.join(tmpdir(),'mosaic-review-')); t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new ApplicationStore(home),file=path.join(home,'test.pdf'),bytes=Buffer.from('%PDF-1.4 test');await writeFile(file,bytes);
  await seedQuality(home,posting,file);await store.write('quality-reviews.json',{});
  await store.write('application-profile.json',profile);await store.write('history.json',[]);await store.write('jobs.json',[posting]);
  await store.write('connections.json',{boards:[],resume:file});await store.write('search.json',{titleLevels:['senior'],titleFields:['engineer'],localCities:[],minAnnualBaseUsd:100000});
  await store.write('application-policy.json',{verifiedProfileSha256:digest(profile),requireICReview:true,maxPerDay:15,dailyBudgetUsd:1,timezone:'UTC'});
  await configureStandingAuthorization({home,evidence:'Synthetic applicant selected automatic native execution with an approved PDF.',
    activate:{acknowledgeAutomationRisk:true,track:'fde',resumeSha256:digest(bytes)}});
  await store.write('application-plan.json',{packets:[],held:[{id:posting.id,company:posting.company,title:posting.title,reason:'Application quality review required',questions:['Complete current role-requirement review needed','Individual-contributor specialization requires review']}]});
  return store;
}
const requirement={text:posting.description,status:'supported',evidenceIds:['synthetic-fact']};
test('role review rejects stale revisions, invented posting requirements, unknown evidence and unbound specialization approvals',async t=>{
  const store=await fixture(t),view=await inboxRoleReview(store,posting.id);
  assert.equal(view.needsIC,true);assert.equal(view.canReviewIC,true);
  const data={jobId:posting.id,revision:view.revision,reviewer:'Actual reviewer',confirm:true,requirements:[requirement],approveIC:true,icEvidence:'I reviewed the matching engineering delivery example.',icFactIds:['synthetic-fact']};
  for(const change of [{revision:'stale'},{requirements:[{...requirement,text:'Other requirement'}]},
      {requirements:[{...requirement,evidenceIds:['missing']}]},{icFactIds:[]},{confirm:false}]){
    await assert.rejects(saveInboxRoleReview(store,{...data,...change}));
    assert.deepEqual(await store.read('quality-reviews.json'),{});
  }
  await store.write('jobs.json',[{...posting,description:posting.description+' The posting changed.'}]);
  await assert.rejects(saveInboxRoleReview(store,data),/changed/);
  await store.write('jobs.json',[posting]);await store.write('application-ledger.json',[{id:'receipt',jobId:posting.id,status:'submission_unknown'}]);
  await assert.rejects(saveInboxRoleReview(store,data),/no longer/);
});
test('scoped Ashby and Lever decisions are per-posting, retain unsafe controls in manual review and exclude closed/handled applications',async t=>{
  const store=await fixture(t),lever={...posting,id:'lever',url:posting.url.replace('jobs.ashbyhq.com','jobs.lever.co')};
  await store.write('jobs.json',[posting,lever,{...posting,id:'closed',listingState:'unlisted'}]);
  const field={label:'What is your notice period?',required:true,type:'text',id:'notice'}, manual={...field,label:'Enter your verification code',id:'code'},form={fields:[field,manual]};
  for(const job of [posting,lever])await observeGreenhouseQuestions({store,job,form,missing:form.fields.map(f=>f.label),profileSha256:digest(profile)});
  const held=[posting,lever,{...posting,id:'closed'}].map(j=>({id:j.id,reason:'Missing verified answers or supported controls',questions:[field.label,manual.label]}));
  await store.write('application-plan.json',{packets:[],held});let inbox=await readDecisionInbox(store);
  assert.equal(inbox.items.length,2);assert.equal(inbox.reviews.length,2);
  for(const i of inbox.items)assert.deepEqual(i.scopes,['posting']);
  for(const row of inbox.reviews)assert.deepEqual(row.questions,[manual.label]);
  const item=inbox.items.find(i=>i.postings[0].jobId===posting.id),observed=item.postings[0];
  const data={store,id:item.id,jobId:posting.id,answer:'Two weeks',channel:'worker',confirm:true,revision:observed.revision};
  await assert.rejects(answerGreenhouseQuestion({...data,scope:'future'}));
  await answerGreenhouseQuestion({...data,scope:'posting'});
  const state=await readGreenhouseAnswers(store);
  assert.equal(greenhouseAnswerFor(state,{field,form,job:posting,profileSha256:digest(profile)}),'Two weeks');
  assert.equal(greenhouseAnswerFor(state,{field,form,job:lever,profileSha256:digest(profile)}),undefined);
  await store.write('application-ledger.json',[{id:'uncertain',status:'submission_unknown',jobId:posting.id,url:posting.url}]);
  inbox=await readDecisionInbox(store);assert.deepEqual(inbox.reviews.map(r=>r.kind),['receipt','form']);
  assert.equal(inbox.items.length,1);
});
test('dashboard separates current verification from passive tracking and retains qualification review', {skip:process.env.MOSAIC_BROWSER_TESTS!=='1',timeout:30000},async t=>{
  const store=await fixture(t);
  const attempts = [
    {id:'old-receipt',jobId:'old',url:'https://job-boards.greenhouse.io/example/jobs/105',company:'Previous',title:'Unverified receipt',status:'submission_unknown'},
    {id:'draft',jobId:'draft',url:'https://job-boards.greenhouse.io/example/jobs/106',company:'Previous',title:'Held draft',status:'held'},
    {id:'verification',jobId:'waiting',url:'https://job-boards.greenhouse.io/example/jobs/107',company:'Current',title:'Original email challenge',status:'submission_unknown',
      emailVerificationPending:true,verificationCheckpoint:{schema:2},verificationDashboardPort:4322},
  ];
  await store.write('application-ledger.json',attempts);
  const child=spawn(process.execPath,[new URL('../src/server.js',import.meta.url).pathname],{
    env:{...process.env,ROLEMOSAIC_HOME:store.root,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    const [banner]=await once(child.stdout,'data',{signal:AbortSignal.timeout(6000)});
    const base=String(banner).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const {chromium}=await import('playwright');browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
    const page=await browser.newPage(),outbound=[];page.setDefaultTimeout(6000);
    await page.route('**/*',r=>{if(new URL(r.request().url()).origin===base)return r.continue();outbound.push(r.request().url());return r.abort();});
    await page.goto(base+'/#inbox');
    await page.locator('#inboxSummary').getByText('1 verification',{exact:true}).waitFor();
    assert.equal(await page.locator('#inboxTracking').evaluate(node=>node.open),false);
    assert.equal(await page.locator('#inboxTrackingSummary').textContent(),'Application tracking (3)');
    assert.equal(await page.locator('#inboxReviews summary').count(),0);
    await page.locator('#inboxChallengeList summary').click();
    assert.equal(await page.locator('#inboxChallengeList a').getAttribute('href'),'http://127.0.0.1:4322/#attempt-verification');
    await page.locator('#inboxTrackingSummary').click();
    await page.locator('#inboxTrackingList summary').filter({hasText:'Review qualifications'}).click();
    await page.getByRole('button',{name:'Review this role',exact:true}).click();
    await page.getByLabel('Exact wording from the posting').fill(posting.description);
    await page.getByLabel('Assessment',{exact:true}).selectOption('supported');
    await page.getByLabel('Verified facts',{exact:true}).selectOption('synthetic-fact');
    await page.getByLabel(/I reviewed this individual-contributor/).check();
    await page.getByLabel(/How does your experience/).fill('My engineering delivery work is documented in the selected evidence.');
    await page.getByLabel('Evidence for the specialization').selectOption('synthetic-fact');
    await page.getByLabel('Reviewer name').fill('Test reviewer');
    await page.getByLabel(/I reviewed every mandatory/).check();
    const ack=page.waitForResponse(r=>r.url()===base+'/api/inbox/role-review'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Save role review'}).click();
    assert.equal((await ack).status(),200);await page.getByText('Review saved. Run Mosaic', {exact:false}).waitFor();
    const policy=await store.read('application-policy.json');assert.equal(meetsContributorRule(posting,policy),true);
    const ic=policy.individualContributorReviews[0];assert.equal(ic.profileSha256,policy.standingAuthorization.profileSha256);
    assert.equal(meetsContributorRule(posting,policy,new Date(Date.parse(ic.reviewedAt)+86400001)),false);
    assert.deepEqual((await store.read('quality-reviews.json')).role.requirements,[requirement]);
    assert.deepEqual(await store.read('application-ledger.json',[]),attempts);
    const closed = attempts.map(row=>row.id==='verification'?{...row,emailVerificationPending:false}:row);
    await store.write('application-ledger.json',closed);
    await page.evaluate(()=>window.dispatchEvent(new Event('mosaic-run-finished')));
    await page.getByText('Nothing needs your input right now.',{exact:true}).waitFor();
    assert.equal(await page.locator('#inboxChallenges').isVisible(),false);
    assert.ok(await page.locator('#inboxTrackingList').getByText(/Original email challenge/).count());
    assert.deepEqual(outbound,[]);
  } finally {await browser?.close();if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}}
});

test('only a checkpointed pending email verification links to its original loopback dashboard',async t=>{
  const store=await fixture(t);
  const base={id:'original',url:posting.url,company:posting.company,title:posting.title,status:'submission_unknown',
    verificationDashboardPort:4317,emailVerificationPending:true,verificationCheckpoint:{formDigest:'sample'}};
  const cases=[base,{...base,id:'port',verificationDashboardPort:'https://example.org'},
    {...base,id:'draft',status:'held'},{...base,id:'lost',verificationCheckpoint:null}];
  await store.write('application-ledger.json',cases);
  const {reviews}=await readDecisionInbox(store);
  assert.deepEqual(reviews.filter(row=>row.verificationDashboardPort).map(r=>[r.attemptId,r.verificationDashboardPort]),[['original',4317]]);
});
