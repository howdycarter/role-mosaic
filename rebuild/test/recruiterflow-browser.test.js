import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ApplicationStore,digest,prepareApplications,runApplications,samePosting,configureStandingAuthorization,supportedPosting} from '../src/applications.js';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';
import {loadEvidence} from '../src/quality.js';
import {recruiterflowExperience,recruiterflowCompensation,monthValue} from '../src/recruiterflow.js';
import {seedQuality} from './helpers/quality-fixture.js';

const job={id:'synthetic-job',source:'recruiterflow',sourceId:'444',title:'Founding Forward Deployed Engineer',
  company:'Rethink Recruit / Example Tools',url:'https://recruiterflow.com/rethinkrecruit/jobs/444',location:'Austin, TX',
  description:'WHY EXAMPLE TOOLS EXISTS\nStarting base around $210K, with a path to $280K subject to funding. Based in Austin.',
  compensation:{currency:'USD',interval:'year',min:210000,max:210000}};
const source='### Software Engineer\n\n<b>Sample Company</b> | Example City | Jan 2019 – Dec 2021\n';
const bits=[
 ['first-name','input-personal-name-first-name','text','First name'],['last-name','input-personal-name-last-name','text','Last name'],
 ['email','input-personal-email','email','Email address'],['user-phone','input-personal-phone','tel','Enter phone number'],
 ['company','input-experience-0-company','text','Company Name'],['title','input-experience-0-title','text','Title'],
 ['','input-experience-0-start-date','text','Start Date'],['','input-experience-0-end-date','text','End Date']
];
function layout() {
  return '<title>Apply to '+job.title+' at Rethink recruit</title><div><div class="header-title">'+job.title+'</div><div>Full time</div></div>'+
    '<div class="location-text">Austin, TX</div><div class="rf-careers-job-description-container" style="white-space:pre">'+job.description+'</div>'+
    '<div id="rf-application-form-scroll-target" data-testid="application-form-container-root"><form>'+
    ['Upload Resume *','Full Name *','Email *','Phone','Experience *'].map(l=>'<div class="form-label">'+l+'</div>').join('')+
    '<input type="file" id="fileInput" data-testid="application-form-input-resume-upload"><span id="filename"></span>'+
    bits.map(([id,test,type,ph])=>'<input id="'+(id&&((id==='user-phone'?'':'rf-application-form-')+id))+
      '" data-testid="application-form-'+test+'" type="'+type+'" placeholder="'+ph+'">').join('')+
    '<div><input id="data-policy" type="checkbox" data-testid="application-form-checkbox-experience-0-current">'+
    '<label class="current-checkbox-label">I am currently working in this role</label></div>'+
    '<button type="button" id="submit-application-button" data-testid="application-form-button-submit">Submit Application</button>'+
    '</form></div><script>'+
    "fileInput.onchange=()=>filename.textContent=fileInput.files[0].name;"+
    "for(const c of document.querySelectorAll('input[placeholder$=Date]'))c.onclick=()=>{document.querySelector('.react-datepicker')?.remove();let y=2025;"+
    "const picker=document.createElement('div');picker.className='react-datepicker';c.after(picker);function draw(){picker.replaceChildren();"+
    "const prev=document.createElement('button');prev.type='button';prev.textContent='Previous Year';prev.onclick=()=>{y--;draw()};picker.append(prev);"+
    "for(let i=0;i<12;i++){const m=new Date(2000,i,1).toLocaleString('en-US',{month:'long'}),op=document.createElement('div');op.setAttribute('role','option');"+
    "op.setAttribute('aria-label','Choose '+m+' '+y);op.textContent=m.slice(0,3);op.onclick=()=>{c.value=m.slice(0,3)+' '+y;picker.remove()};picker.append(op)}}draw()};"+
    "document.querySelector('#submit-application-button').onclick=()=>{const values=[...document.querySelectorAll('input')].map(i=>i.value);"+
    "if(!values.includes('Sample Company')||!values.includes('Software Engineer')||!values.includes('Jan 2019')||!values.includes('Dec 2021')||!values.includes('person@example.invalid'))return;"+
    "document.body.textContent='Your application has been submitted'};"+
    '</script>';
}

test('Recruiterflow scopes the recipient, compensation, and exact month precision',()=>{
  assert.ok(supportedPosting(job.url));assert.ok(samePosting(job.url,job.url));
  for(const url of [job.url+'?redirect=away',job.url+'#x',job.url.replace('/rethinkrecruit','/another'),job.url.replace('https','http')]){
    assert.equal(supportedPosting(url),false);assert.equal(samePosting(job.url,url),false);
  }
  assert.equal(recruiterflowCompensation(job.description,job.location,true,true).max,210000);
  for(const args of [[job.description,'Denver, CO',true,true],[job.description,job.location,true,false],
    [job.description,job.location,false,true],['Based in Austin. Future base up to $280K once funded.',job.location,true,true]]){
    assert.equal(recruiterflowCompensation(...args),null);
  }
  assert.equal(monthValue('January, 2022'),'2022-01');assert.equal(monthValue('Jan 1, 2022'),null);
});

test('an original pre-submit Recruiterflow draft resumes once and captures only explicit employer confirmation',
  {skip:process.env.MOSAIC_BROWSER_TESTS!=='1',timeout:60000},async t=>{
    const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-rf-'));t.after(()=>rm(home,{recursive:true,force:true}));
    const store=new ApplicationStore(home),pdf=path.join(home,'example.pdf'),bytes='%PDF-1.4 synthetic file';
    await writeFile(pdf,bytes);await seedQuality(home,job,pdf);
    await writeFile(path.join(home,'prior.md'),source);
    const raw=await store.read('career-evidence.json',{}),reviews=await store.read('quality-reviews.json',{});
    raw.sources.push({id:'prior',path:'prior.md',sha256:digest(source)});await store.write('career-evidence.json',raw);
    reviews[job.id].evidenceDigest=(await loadEvidence(home)).digest;await store.write('quality-reviews.json',reviews);
    const profile={verified:true,facts:{firstName:'Example',lastName:'Applicant',fullName:'Example Applicant',email:'person@example.invalid'}};
    const ctx={profileSha256:digest(profile),resumeSha256:digest(bytes)};
    const ref={posting:job.url,...ctx,sourceId:'prior',sourceSha256:digest(source),company:'Sample Company',title:'Software Engineer'};
    await store.write('posting-experience.json',{[job.id]:ref});
    assert.deepEqual(await recruiterflowExperience(store,job,ctx),{company:'Sample Company',title:'Software Engineer',start:'2019-01',end:'2021-12'});
    assert.deepEqual(await recruiterflowExperience(store,job,{...ctx,profileSha256:'different'}),{});
    await store.write('application-profile.json',profile);
    await store.write('search.json',{titleLevels:[],titleFields:[],localCities:['Austin'],minAnnualBaseUsd:190000,allowAnnualBaseAssumption:true,fdeTarget:{enabled:true,levels:['founding']}});
    await store.write('connections.json',{resume:pdf});await store.write('history.json',[]);await store.write('jobs.json',[job]);
    await store.write('application-policy.json',{enabled:true,maxPerDay:15,dailyBudgetUsd:1,timezone:'America/Chicago',
      verifiedProfileSha256:ctx.profileSha256,requireICReview:false,applicationResumeTrack:'fde'});
    await configureStandingAuthorization({home,enabled:true,evidence:'Synthetic scoped grant',activate:{acknowledgeAutomationRisk:true,track:'fde',resumeSha256:ctx.resumeSha256}});
    await store.write('application-plan.json',{packets:[],held:[]});
    const original={id:'preserved-draft',jobId:job.id,url:job.url,company:job.company,title:job.title,status:'held',resumeSha256:ctx.resumeSha256,
      createdAt:new Date().toISOString(),transport:'user-directed-chrome'};
    await store.write('application-ledger.json',[original]);
    const {chromium}=await import('playwright'),browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
    t.after(()=>browser.close());const context=await browser.newContext({serviceWorkers:'block'});const requests=[];
    await context.route('**/*',route=>{requests.push(route.request().url());return route.request().url()===job.url?route.fulfill({contentType:'text/html',body:layout()}):route.abort();});
    const adapter=new PlaywrightApplicationAdapter(context,{home});
    assert.equal((await prepareApplications({home,adapter,jobIds:[job.id]})).packets.length,0);
    const inspection=await adapter.inspect(job),page=inspection.tab.page;
    await page.evaluate(()=>document.querySelector('form').insertAdjacentHTML('beforeend','<input type="checkbox" aria-label="New consent">'));
    await assert.rejects(adapter.inspect(job),/additional controls/);
    await page.evaluate(()=>document.querySelector('[aria-label="New consent"]').remove());
    const results=await runApplications({home,adapter,resumeAttemptId:original.id});
    assert.equal(results[0]?.status,'submitted',JSON.stringify(results));assert.ok(results[0].receipt.confirmed);
    assert.equal((await store.read('application-ledger.json',[])).length,1);assert.equal(results[0].id,original.id);
    assert.equal((await store.read('history.json',[])).length,1);
    assert.ok((await adapter.recoverReceipt(results[0])).confirmed);
    await page.evaluate(()=>{document.body.textContent='You already applied. Thank you for applying.'});
    assert.equal((await adapter.recoverReceipt(results[0])).confirmed,false);
    assert.deepEqual(requests,[job.url]);
});
