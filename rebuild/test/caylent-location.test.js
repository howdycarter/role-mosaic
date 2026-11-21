import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchBoard, livePostingEvidence} from '../src/sources.js';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';
import {htmlText} from '../src/career.js';

const board = {type:'greenhouse',slug:'caylent',company:'Caylent'};
const title = 'Senior Forward Deployed Engineer';
const hosted = 'https://job-boards.greenhouse.io/caylent/jobs/101';
const careers = 'https://caylent.com/careers/101';
const paragraphs = [
  'We are a fully remote global company with employees in Canada, the United States and Latin America.',
  'Build production systems.',
  'Equipment &amp; Office Stipend',
  'This role may require up to 50% travel, depending on business needs.',
  'Base Salary Range: The expected base salary range for this position is <span>$136,000</span>&nbsp;-&nbsp;<span>$216,000</span> per year, commensurate with experience and qualifications.',
  'Additional Compensation Components: In addition to the base salary, the compensation package may include bonuses, commissions, equity, and other incentives.'
];
const markup = lines => lines.map(line => '<p>'+line+'</p>').join('');
const encode = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const original = {id:101,company_name:'Caylent',title,absolute_url:hosted,location:{name:'USA'},
  offices:[{name:'Remote',location:null,parent_id:null,child_ids:[]}],content:encode(markup(paragraphs))};
function employerHtml(row,changes={}) {
  const data = {'@type':'JobPosting', url:careers,title:row.title,identifier:{name:'Caylent',value:'101'},
    hiringOrganization:{sameAs:'https://caylent.com'},jobLocationType:'TELECOMMUTE',
    applicantLocationRequirements:{'@type':'Country',name:'USA'},description:htmlText(htmlText(row.content)),...changes};
  return '<script type="application/ld+json">'+JSON.stringify([data])+'</script>';
}
function employer(row=original, html=employerHtml(row)) {
  return async (url,options) => {
    assert.equal(options.redirect,'error');
    if (url===careers) return new Response(html);
    if (url.endsWith('/jobs?content=true')) return Response.json({jobs:[row]});
    assert.match(url,/^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/caylent\/jobs\/101\?pay_transparency=true/);
    return Response.json(row);
  };
}

test('a Caylent US office, country, role clauses and individual employer posting corroborate remote work and annual base', async()=>{
  const [discovered] = await fetchBoard(board,employer());
  const live = await livePostingEvidence(discovered,employer());
  for(const job of [discovered,live]) {
    assert.equal(job.location,'Remote, United States');
    assert.deepEqual([job.compensation.min,job.compensation.max,job.compensation.currency,job.compensation.interval],
      [136000,216000,'USD','year']);
    assert.equal(job.compensation.periodAssumed,undefined);
    assert.match(job.compensation.evidence,/per year/);
  }
  for(const override of [{title:title+' | New York or San Francisco (Onsite)'},{company_name:'Other'},
    {offices:[{name:'Remote',location:'New York'}]}, {location:{name:'Canada'}},
    {offices:[{name:'Remote',location:null},{name:'New York',location:null}]},
    ...['This position is based onsite in New York City or San Francisco.', 'Texas candidates are excluded.',
      'This is a hybrid role.', 'Candidates must reside near an office.', 'The role is limited to Eastern time.',
      'Applications limited to Oregon.'].map(text=>({content:encode(markup([...paragraphs,text]))}))]) {
    const fetcher=employer({...original,...override});const [row]=await fetchBoard(board,fetcher);
    assert.notEqual(row.location,'Remote, United States',JSON.stringify(override));
    assert.notEqual((await livePostingEvidence(row,fetcher)).location,'Remote, United States');
  }
  for(const changes of [{jobLocationType:'ONSITE'}, {identifier:{name:'Caylent',value:'999'}},
    {applicantLocationRequirements:{'@type':'Country',name:'Canada'}},{description:'New constraints.'}]) {
    assert.notEqual((await livePostingEvidence(discovered,employer(original,employerHtml(original,changes)))).location,'Remote, United States');
  }
});

test('the encoded Caylent salary template refuses extra geography, variable pay, nonannual pay and ambiguous tiers',async()=>{
  const salary=paragraphs[4];
  for(const lines of [[...paragraphs,'There is a second salary range of $250,000.'],
    ...[' per month',' OTE per year',' CAD per year',' per year for New York residents',
      ' per year including bonuses'].map(period=>paragraphs.map(line=>line.replace(' per year',period))),
    paragraphs.map(line=>line===salary?line.replace('$216,000','$116,000'):line)]) {
    const fetcher=employer({...original,content:encode(markup(lines))});
    const [row]=await fetchBoard(board,fetcher);
    assert.equal(row.compensation,null);
    assert.equal((await livePostingEvidence(row,fetcher,{allowAnnualBaseAssumption:true})).compensation,null);
  }
});

test('native Caylent preflight requires the exact country header and matching rendered job description', {skip:!process.env.MOSAIC_BROWSER_TESTS},async t=>{
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
  t.after(()=>browser.close());
  const context=await browser.newContext();
  await context.route('**/*', route=>route.request().url()===hosted?route.fulfill({contentType:'text/html',
    body:'<div class="job__header"><h1>'+title+'</h1><div class="job__location">USA</div></div><div class="job__description">'+
      markup(paragraphs)+'</div><form><h2>Apply for this job</h2><label for="first_name">First name</label><input id="first_name"></form>'}):route.abort());
  const adapter=new PlaywrightApplicationAdapter(context,{home:'/not-a-real-profile',evidenceLoader:(job,_,rules)=>livePostingEvidence(job,employer(),rules)});
  const [discovered]=await fetchBoard(board,employer());
  const job={...discovered,id:'caylent-synthetic'};
  const seen=await adapter.inspect(job);
  assert.equal(seen.location,'Remote, United States');assert.equal(seen.compensation.max,216000);
  const page=seen.tab.page;
  const unavailable=new PlaywrightApplicationAdapter(context,{home:'/not-a-real-profile',evidenceLoader:async()=>{throw Error('Employer temporarily unavailable');}});
  assert.equal((await unavailable.inspect(job)).location,'Location restrictions require review');
  await page.locator('.job__location').evaluate(node=>node.textContent='USA – New York residents');
  assert.equal((await adapter.inspect(job,{tabId:seen.tabId})).location,'Location restrictions require review');
  await page.locator('.job__location').evaluate(node=>node.textContent='USA');
  await page.locator('.job__description').evaluate(node=>node.append(' Attendance is required in Boston.'));
  assert.equal((await adapter.inspect(job,{tabId:seen.tabId})).location,'Location restrictions require review');
});
