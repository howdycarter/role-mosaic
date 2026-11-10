import {test} from 'node:test';import assert from 'node:assert/strict';import {salaryFromText,ashbySalary,livePostingEvidence} from '../src/sources.js';
test('Ashby public annual salary components exclude equity, bonus, OTE and foreign pay, using the lowest USD tier',()=>{
 const component=(min,currency='USD',type='Salary')=>({compensationType:type,interval:'1 YEAR',currencyCode:currency,minValue:min,maxValue:min+20000});
 const pay=ashbySalary({compensationTiers:[{components:[component(250000),component(50000,'USD','Bonus'),component(300000,'CAD')]},{components:[component(210000)]}]});assert.equal(pay.min,210000);assert.equal(pay.max,270000);
 assert.equal(ashbySalary({compensationTiers:[{components:[{...component(300000),summary:'OTE includes commissions'}]}]}),null);
});
test('Greenhouse evidence binds the posting and requires explicit full-time salaried metadata for its USD base band',async()=>{
 const job={url:'https://job-boards.greenhouse.io/example/jobs/123'},data={id:123,title:'Director of Product',location:{name:'Remote US'},metadata:[{name:'Time Type',value:'Full time'},{name:'Pay Rate Type',value:'Salary'}],pay_input_ranges:[{title:'Base salary range',currency_type:'USD',min_cents:20000000,max_cents:25000000}]};const fetcher=async url=>{assert.equal(url,'https://boards-api.greenhouse.io/v1/boards/example/jobs/123?pay_transparency=true');return new Response(JSON.stringify(data))};
 assert.equal((await livePostingEvidence(job,fetcher)).compensation.min,200000);data.metadata=[];assert.equal((await livePostingEvidence(job,fetcher)).compensation,null);data.id=456;assert.equal(await livePostingEvidence(job,fetcher),null);
});
test('base salary evidence preserves range and refuses hourly, foreign and equity-only figures',()=>{
 assert.equal(salaryFromText('Annual base salary is $200,000 - $250,000 USD').min,200000);
 assert.equal(salaryFromText('Base salary $200,000 - $250,000 CAD per year'),null);
 assert.equal(salaryFromText('Total compensation $200,000 - $250,000 annually'),null);
 assert.equal(salaryFromText('Base pay $200 - $250 per hour'),null);
});

test('GitLab annual pay requires its live employer policy and exact USD base-only structured band',async()=>{
 const job={url:'https://job-boards.greenhouse.io/gitlab/jobs/123'},data={id:123,title:'Director of Product',pay_input_ranges:[{title:'United States Salary Range',currency_type:'USD',min_cents:20320000,max_cents:34560000,blurb:'The base salary range does not include any bonuses, equity, or benefits.'}]};let policy=true;
 const fetcher=async url=>url.includes('boards-api.greenhouse.io')?new Response(JSON.stringify(data)):new Response(policy?'<p>Base salary is annual guaranteed pay</p>':'No period evidence');
 assert.equal((await livePostingEvidence(job,fetcher)).compensation.min,203200);policy=false;assert.equal((await livePostingEvidence(job,fetcher)).compensation,null);
 policy=true;assert.equal((await livePostingEvidence({url:job.url.replace('/gitlab/','/other/')},fetcher)).compensation,null);
});

test('opt-in annual assumption accepts an ordinary US base band and preserves assumption provenance',async()=>{
 const job={url:'https://job-boards.greenhouse.io/example/jobs/123'},data={id:123,title:'Director of Product',location:{name:'Remote - United States'},pay_input_ranges:[{title:'Base Compensation Range',currency_type:'USD',min_cents:18500000,max_cents:25500000}]};
 const fetcher=async()=>new Response(JSON.stringify(data)),rules={allowAnnualBaseAssumption:true};
 assert.equal((await livePostingEvidence(job,fetcher)).compensation,null);
 const pay=(await livePostingEvidence(job,fetcher,rules)).compensation;assert.equal(pay.min,185000);assert.equal(pay.max,255000);assert.equal(pay.interval,'year');assert.equal(pay.periodAssumed,true);
 data.location.name='Remote - Canada';assert.equal((await livePostingEvidence(job,fetcher,rules)).compensation,null);
 data.location.name='Remote - United States';data.pay_input_ranges[0].title='Hourly base salary';assert.equal((await livePostingEvidence(job,fetcher,rules)).compensation,null);
 data.pay_input_ranges[0].title='Base salary per week';assert.equal((await livePostingEvidence(job,fetcher,rules)).compensation,null);
 data.pay_input_ranges[0].title='Total compensation';assert.equal((await livePostingEvidence(job,fetcher,rules)).compensation,null);
 data.pay_input_ranges[0].title='Base Salary';data.metadata=[{name:'Time Type',value:'Part time'}];assert.equal((await livePostingEvidence(job,fetcher,rules)).compensation,null);
});
test('opt-in conventional annual salary assumption never overrides another currency or pay period',()=>{
 const rules={allowAnnualBaseAssumption:true,location:'US - NY Area or Remote'};
 assert.equal(salaryFromText('$200,000 - $225,000 base salary and equity'),null);
 assert.equal(salaryFromText('$200,000 - $225,000 base salary and equity',rules)?.min,200000);
 assert.equal(salaryFromText('$200,000 - $225,000 base salary CAD',rules),null);
 assert.equal(salaryFromText('Base salary $20,000 - $25,000 per month',rules),null);
 assert.equal(salaryFromText('Base salary $200,000 - $225,000',{...rules,location:'Canada'}),null);
});
