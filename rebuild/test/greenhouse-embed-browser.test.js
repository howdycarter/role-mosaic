import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mongoEmbedRoute} from '../src/greenhouse-embed.js';
import {postingKey,samePosting,supportedPosting} from '../src/applications.js';
import {livePostingEvidence} from '../src/sources.js';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';
import {campaignProgress} from '../src/campaign.js';

const job={id:'synthetic',company:'MongoDB',source:'greenhouse/mongodb',sourceId:'101',title:'Synthetic Deployment Engineer',
  url:'https://www.mongodb.com/careers/job/?gh_jid=101'};
const form='https://job-boards.greenhouse.io/embed/job_app?for=mongodb&token=101';
const firstParty='https://www.mongodb.com/careers/jobs/101';
const title='Job Application for '+job.title+' at MongoDB';
const employerHtml='<title>'+job.title+'</title><script src="https://boards.greenhouse.io/embed/job_board/js?for=mongodb"></script>';
const detail={id:101,company_name:'MongoDB',title:job.title,absolute_url:job.url,
  content:'Build enterprise applications.',location:{name:'Austin; United States'},
  metadata:[{name:'Employment Type',value:'Full-time'},
    {name:'Job Post Range (United States)',value:{unit:'USD',min_value:'150000',max_value:'200000'}}],
  pay_input_ranges:[{currency_type:'USD',min_cents:15000000,max_cents:20000000,
    title:'MongoDB’s base salary range for this role in the U.S. is:',blurb:'Salary is one part of total compensation.'}]};

function evidenceFetcher(row=detail,html=employerHtml) {
  return async (url,options)=>{
    assert.equal(options.redirect,'error');
    if(url===firstParty)return new Response(html);
    assert.match(url,/^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/mongodb\/jobs\/101\?/);
    return Response.json(row);
  };
}

test('an employer embed binds its URL, board, title, public API and first-party careers page',async()=>{
  for (const alias of [form,firstParty,'https://job-boards.greenhouse.io/mongodb/jobs/101']) {
    assert.ok(samePosting(alias,job.url));assert.equal(postingKey(alias),postingKey(job.url));
  }
  for(const address of [form+'&for=other',form+'&token=100',form+'&redirect=other',
    form.replace('mongodb','other'),form.replace('101','100'),form.replace('.io','.io.example'),
    'https://job-boards.greenhouse.io/other/jobs/101','https://example.org/?gh_jid=101']) {
    assert.equal(samePosting(job.url,address),false,address);
  }
  assert.equal(supportedPosting('https://www.mongodb.com/unrelated'),false);
  assert.equal(mongoEmbedRoute(job.url+'&gh_jid=102'),null);
  const get=(j=job,fetcher=evidenceFetcher())=>livePostingEvidence(j,fetcher,{allowAnnualBaseAssumption:true});
  const bound=await get();assert.equal(bound.applicationUrl,form);assert.equal(bound.compensation.max,200000);
  for(const bad of [{id:102},{company_name:'Other'},{title:'Different'},{absolute_url:'https://example.com/?gh_jid=101'}]) {
    assert.equal(await get(job,evidenceFetcher({...detail,...bad})),null);
  }
  assert.equal(await get({...job,source:'greenhouse/other'}),null);
  assert.equal(await get(job,evidenceFetcher(detail,employerHtml.replace('for=mongodb','for=other'))),null);
  assert.equal(await get(job,evidenceFetcher(detail,employerHtml.replace(job.title,'Different'))),null);
  assert.equal((await get(job,evidenceFetcher({...detail,metadata:[]}))).compensation,null);
});

test('native embed fills, submits, and reconciles only the exact synthetic application', {skip:!process.env.MOSAIC_BROWSER_TESTS},async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'rolemosaic-embed-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(path.join(home,'search.json'),JSON.stringify({allowAnnualBaseAssumption:true}));
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
  t.after(()=>browser.close());const context=await browser.newContext();
  const observed=[];
  await context.route('**/*',async route=>{
    observed.push(route.request().url());
    if(route.request().url()!==form)return route.abort();
    await route.fulfill({contentType:'text/html',body:`<title>${title}</title><form id="application-form" action="${form.replace('&','&amp;')}">
      <label for="first_name">First name</label><input required id="first_name">
      <label for="resume">Resume</label><input required type="file" id="resume"><span id="filename"></span>
      <button type="submit">Submit application</button></form>
      <script>resume.onchange=()=>filename.textContent=resume.files[0].name;
      document.forms[0].onsubmit=e=>{e.preventDefault();document.body.textContent='Thank you for applying';};</script>`});
  });
  const adapter=new PlaywrightApplicationAdapter(context,{home,evidenceLoader:(j,_,r)=>livePostingEvidence(j,evidenceFetcher(),r)});
  const inspected=await adapter.inspect(job),page=inspected.tab.page;
  assert.ok(inspected.titleVerified);assert.equal(inspected.location,detail.location.name);assert.equal(inspected.url,form);
  const actions=[{field:inspected.form.fields.find(f=>f.id==='first_name'),value:'Synthetic'}];
  const resume=path.join(home,'synthetic.pdf');await writeFile(resume,'%PDF-1.4 synthetic');
  await page.evaluate(()=>document.forms[0].action='/embed/job_app?for=other&token=101');
  await assert.rejects(adapter.fill(inspected,actions,resume),/identity is unverified/);
  assert.equal(await page.locator('#first_name').inputValue(),'');
  await page.evaluate(url=>document.forms[0].action=url,form);
  await adapter.fill(inspected,actions,resume);
  assert.equal(await page.locator('#first_name').inputValue(),'Synthetic');
  await page.evaluate(()=>document.title='Different employer');
  await assert.rejects(adapter.submit(inspected),/identity is unverified/);
  await page.evaluate(value=>document.title=value,title);
  await adapter.submit(inspected);
  const receipt=await adapter.confirm(inspected,{waitMs:0});
  assert.ok(receipt.confirmed);assert.equal(receipt.posting,form);
  const attempt={jobId:job.id,title:job.title,url:job.url,tabId:inspected.tabId};
  assert.ok((await adapter.recoverReceipt(attempt)).confirmed);
  const submitted={...attempt,id:'example',status:'submitted',submittedAt:'2026-01-02T12:00:00Z',receipt};
  await writeFile(path.join(home,'campaign.json'),JSON.stringify({enabled:true,targetConfirmed:15,since:'2026-01-02T00:00:00Z'}));
  for (const [posting,count] of [[form,1],[firstParty,0],[form+'&token=102',0],
    [form.replace('mongodb','other'),0],[form.replace('101','102'),0]]) {
    await writeFile(path.join(home,'application-ledger.json'),JSON.stringify([{...submitted,receipt:{...receipt,posting}}]));
    assert.equal((await campaignProgress({home,now:new Date('2026-01-02T16:00:00Z')})).confirmed,count,posting);
  }
  await page.evaluate(()=>history.replaceState(null,'','/embed/job_app?for=other&token=101'));
  assert.equal((await adapter.recoverReceipt(attempt)).confirmed,false);
  assert.deepEqual(observed,[form]);
});
