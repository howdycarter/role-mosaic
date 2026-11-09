import {test} from 'node:test';import assert from 'node:assert/strict';import {salaryFromText} from '../src/sources.js';
test('base salary evidence preserves range and refuses hourly, foreign and equity-only figures',()=>{
 assert.equal(salaryFromText('Annual base salary is $200,000 - $250,000 USD').min,200000);
 assert.equal(salaryFromText('Base salary $200,000 - $250,000 CAD per year'),null);
 assert.equal(salaryFromText('Total compensation $200,000 - $250,000 annually'),null);
 assert.equal(salaryFromText('Base pay $200 - $250 per hour'),null);
});
