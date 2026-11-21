import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ApplicationStore,configureStandingAuthorization,digest,prepareApplications} from '../src/applications.js';
import {readDecisionInbox} from '../src/decision-inbox.js';
import {inboxRoleReview,saveEvidenceReplies} from '../src/inbox-role-review.js';
import {mandatoryClauses,reviewWithEvidence} from '../src/evidence-review.js';
import {makeRoleReview} from '../src/packets.js';
import {loadEvidence,selectTrackResume} from '../src/quality.js';
import {seedQuality} from './helpers/quality-fixture.js';

const clauses = ['Build deployment workflows.', 'Debug production queues.'];
const description = ['Required Qualifications',...clauses,'P referred Qualifications','Optional academic work.'].join('\n');
const job = {id:'new',title:'Senior Forward Deployed Engineer',company:'Example',location:'Remote US',
  description,url:'https://job-boards.greenhouse.io/example/jobs/123'};
const other = {...job,id:'old',url:'https://job-boards.greenhouse.io/other/jobs/123'};
const evidence = {digest:'sources',facts:[
  {id:'delivery',tracks:['fde'],capabilities:[]},
  {id:'preference',tracks:['fde'],capabilities:['applicant-hands-on-work-preference']},
],caseStudies:[{id:'study',tracks:['fde'],evidenceIds:['delivery']}]};
const resume = {track:'fde',status:'approved',sha256:'approved-bytes'};
const rows = clauses.map(text => ({text,status:'supported',evidenceIds:['delivery']}));
const question = 'Which queue did you personally debug in production?';

test('explicit optional headings end mandatory clauses and later requirements reopen them', () => {
  for (const heading of ['Bonus Qualifications', 'Preferred Backgrounds:', 'Preferred Experience']) {
    const posting = ['Qualifications', clauses[0], heading, 'Public sector experience.',
      'Minimum Requirements', clauses[1]].join('\n');
    assert.deepEqual(mandatoryClauses(posting), clauses);
  }
  const qualifier = 'Bonus Qualifications do not replace the mandatory certification.';
  assert.deepEqual(mandatoryClauses('Requirements\n'+qualifier), [qualifier]);
});

test('Mosaic reuses only complete, compatible reviewed clauses and keeps the source review date',()=>{
  const prior=makeRoleReview(other,evidence,resume,'Actual reviewer',rows);
  assert.deepEqual(mandatoryClauses(description),clauses);
  const result=reviewWithEvidence(job,evidence,resume,{old:prior});
  assert.equal(result.assessment.ready,true);
  assert.deepEqual(result.requirements,rows);
  assert.equal(result.handsOnPreference,true);
  for(const invalid of [{resumeSha256:'other'},{evidenceDigest:'changed'},{track:'design'},
    {reviewedAt:'2001-01-01T00:00:00Z'},{requirements:[rows[0]]}]) {
    assert.equal(reviewWithEvidence(job,evidence,resume,{old:{...prior,...invalid}}).assessment.ready,false);
  }
  const conflicting={...prior,requirements:[rows[0],{...rows[1],status:'contradicted'}]};
  assert.equal(reviewWithEvidence(job,evidence,resume,{old:prior,conflicting}).assessment.ready,false);
  assert.equal(reviewWithEvidence({...job,description:'Experience with mission-critical rail infrastructure is essential.\n'+description},evidence,resume,{old:prior}).assessment.ready,false);
  assert.equal(reviewWithEvidence({...job,description:description.replace(clauses[0],clauses[0]+' Ensure full observability.')},evidence,resume,{old:prior}).assessment.ready,false);
});
test('A bound partial judgment is retained ahead of other postings, with only explicit factual questions',()=>{
  const prior=makeRoleReview(other,evidence,resume,'Initial reviewer',rows);
  const partial=makeRoleReview(job,evidence,resume,'Current reviewer',[rows[0],{...rows[1],status:'unknown',questions:[question]}]);
  const result=reviewWithEvidence(job,evidence,resume,{old:prior,new:partial});
  assert.equal(result.assessment.ready,false);
  assert.deepEqual(result.requirements,partial.requirements);
  assert.deepEqual(result.applicantQuestions,[question]);
  assert.deepEqual(reviewWithEvidence(job,evidence,resume,{}).applicantQuestions,[]);
});

async function workspace(t) {
  const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-evidence-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new ApplicationStore(home), file=path.join(home,'fixture.pdf'), bytes=Buffer.from('%PDF-1.4 synthetic');
  await writeFile(file,bytes);await seedQuality(home,job,file);
  const data=await store.read('career-evidence.json'), quote='I accept hands-on forward deployed engineering roles.';
  await writeFile(path.join(home,'preference.txt'),quote);
  data.sources.push({id:'preference',path:'preference.txt',sha256:digest(quote)});
  data.facts.push({id:'preference',sourceId:'preference',text:quote,quote,verified:true,tracks:['fde'],capabilities:['applicant-hands-on-work-preference']});
  await store.write('career-evidence.json',data);
  const evidence=await loadEvidence(home), resume=await selectTrackResume(home,'fde');
  const profile={verified:true,facts:{fullName:'Example Test',email:'test@example.invalid',stateCode:'TX'}};
  await store.write('application-profile.json',profile);await store.write('history.json',[]);await store.write('jobs.json',[job]);
  await store.write('connections.json',{boards:[],resume:file});
  await store.write('search.json',{titleLevels:['senior'],titleFields:['engineer'],localCities:[],minAnnualBaseUsd:190000,fdeTarget:{enabled:true,levels:['senior']}});
  await store.write('application-policy.json',{verifiedProfileSha256:digest(profile),requireICReview:true,maxPerDay:15,dailyBudgetUsd:1,timezone:'UTC'});
  await configureStandingAuthorization({home,evidence:'Synthetic standing authorization',activate:{acknowledgeAutomationRisk:true,track:'fde',resumeSha256:digest(bytes)}});
  const adapter={transport:'playwright',inspect:async job=>({job,titleVerified:true,title:job.title,location:'Remote - United States',
    description:'Annual base salary $220,000 - $250,000 USD per year',form:{fields:[],resume:{label:'Resume'},submit:{label:'Submit application'}}})};
  const writeReview=async requirements=>store.write('quality-reviews.json',{[job.id]:makeRoleReview(job,evidence,resume,'Operator',requirements)});
  return {home,store,prepare:()=>prepareApplications({home,adapter}),writeReview};
}

test('Native preflight and inbox preserve approved evidence, collect a narrow reply privately, and clear only after source review',async t=>{
  const {store,prepare,writeReview}=await workspace(t);
  const supported=clauses.map(text=>({text,status:'supported',evidenceIds:['synthetic-fact']}));
  await store.write('quality-reviews.json',{});
  const unreviewed=await prepare();
  assert.equal(unreviewed.held[0].needsApplicantInput,false);
  assert.deepEqual((await readDecisionInbox(store)).reviews,[]);
  const second='What did the fix change for the queue?';
  await writeReview([supported[0],{...supported[1],status:'unknown',questions:[question,second]}]);
  const partial=await prepare();
  assert.equal(partial.held[0].needsApplicantInput,true);assert.deepEqual(partial.held[0].questions,[question,second]);
  const inbox=await readDecisionInbox(store);assert.deepEqual(inbox.reviews.map(r=>r.questions),[[question,second]]);
  assert.equal(inbox.reviews[0].focusedEvidence,true);
  const view=await inboxRoleReview(store,job.id), before=await store.read('quality-reviews.json');
  assert.equal(view.needsIC,false);assert.deepEqual(view.requirements,before.new.requirements);
  for(const invalid of [{revision:'stale'},{answers:[{question:'Unasked question',answer:'irrelevant'}]}]){
    await assert.rejects(saveEvidenceReplies(store,{jobId:job.id,revision:view.revision,answers:[{question,answer:'Example'}],...invalid}));
  }
  await saveEvidenceReplies(store,{jobId:job.id,revision:view.revision,answers:[{question,answer:'I debugged the synthetic production queue.'}]});
  assert.deepEqual((await readDecisionInbox(store)).reviews[0].questions,[second]);
  assert.deepEqual(await store.read('quality-reviews.json'),before);
  assert.equal((await store.read('evidence-replies.json'))[0].status,'awaiting-source-review');
  await assert.rejects(saveEvidenceReplies(store,{jobId:job.id,revision:view.revision,answers:[{question,answer:'duplicate'}]}));
  const next=await inboxRoleReview(store,job.id);
  await saveEvidenceReplies(store,{jobId:job.id,revision:next.revision,answers:[{question:second,answer:'I am unsure.'}]});
  assert.deepEqual((await readDecisionInbox(store)).reviews,[]);
  const awaitingReview=await prepare();
  assert.equal(awaitingReview.packets.length,0);assert.equal(awaitingReview.held[0].needsApplicantInput,false);
  await writeReview(supported);
  const verified=await prepare();
  assert.equal(verified.packets.length,1,JSON.stringify(verified.held));
  assert.deepEqual((await store.read('application-policy.json')).individualContributorReviews||[],[]);
  assert.deepEqual(await store.read('application-ledger.json',[]),[]);
});

test('applicant answers a source gap in the local dashboard without reassessing the posting', {
  skip:process.env.MOSAIC_BROWSER_TESTS!=='1',timeout:30000,
},async t=>{
  const {home,store,prepare,writeReview}=await workspace(t);
  await writeReview([{text:clauses[0],status:'supported',evidenceIds:['synthetic-fact']},
    {text:clauses[1],status:'unknown',evidenceIds:[],questions:[question]}]);
  await prepare();const original=await store.read('quality-reviews.json');
  const child=spawn(process.execPath,[new URL('../src/server.js',import.meta.url).pathname],
    {env:{...process.env,ROLEMOSAIC_HOME:home,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    const [banner]=await once(child.stdout,'data',{signal:AbortSignal.timeout(6000)});
    const base=String(banner).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const {chromium}=await import('playwright');
    browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
    const page=await browser.newPage(),outbound=[];page.setDefaultTimeout(7000);
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===base)return route.continue();
      outbound.push(route.request().url());return route.abort();
    });
    await page.goto(base+'/#inbox');await page.locator('#inboxReviews summary').click();
    await page.getByRole('button',{name:'Answer questions'}).click();
    await page.getByLabel(question,{exact:true}).fill('I handled an example synthetic deployment queue.');
    assert.equal(await page.getByLabel('Reviewer name').count(),0);
    const saved=page.waitForResponse(r=>r.url()===base+'/api/inbox/evidence-replies'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Save answers'}).click();assert.equal((await saved).status(),200);
    await page.locator('#inboxReviews summary').waitFor({state:'detached'});
    assert.deepEqual(await store.read('quality-reviews.json'),original);assert.deepEqual(outbound,[]);
    assert.equal((await store.read('evidence-replies.json'))[0].question,question);
  } finally {
    await browser?.close();
    if(child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill();await exited;}
  }
});
