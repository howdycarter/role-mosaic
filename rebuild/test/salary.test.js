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
