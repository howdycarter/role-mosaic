import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, identity, mergeJobs, historyMatch } from '../src/core.js';
import { fetchBoard } from '../src/sources.js';
const config={titleLevels:['Director','VP'],titleFields:['Product','Design','Engineering'],localCities:['Austin'],minAnnualBaseUsd:190000};
const job={title:'Director of Product',company:'Example',location:'Remote, United States',url:'https://example.com/jobs/123',seenAt:'2026-01-01',compensation:{min:200000,currency:'USD',interval:'year'}};
test('matching requires title and location evidence and excludes internships',()=>{assert.equal(evaluate(job,config).score,100); assert.equal(evaluate({...job,location:'Remote, Europe'},config).disposition,'review'); assert.equal(evaluate({...job,title:'Product Director Intern'},config).disposition,'review');});
test('refresh preserves application state and canonicalizes URL',()=>{const a=mergeJobs([],[job]);a[0].status='applied';const b=mergeJobs(a,[{...job,url:job.url+'?tracking=1',seenAt:'2026-02-01'}]);assert.equal(b.length,1);assert.equal(b[0].status,'applied');assert.equal(b[0].firstSeen,'2026-01-01');assert.equal(identity(job),identity(b[0]));});
test('history requires exact company and title or posting',()=>{assert.ok(historyMatch(job,[{company:'EXAMPLE',role:'Director of Product'}]));assert.equal(historyMatch(job,[{company:'Example',role:'VP of Product'}]),null);});
test('source rejects bad boards and maps greenhouse results',async()=>{await assert.rejects(fetchBoard({type:'greenhouse',slug:'../evil'})); const result=await fetchBoard({type:'greenhouse',slug:'example',company:'Example'},async()=>({ok:true,json:async()=>({jobs:[{title:'Director',absolute_url:'https://example.com/1',location:{name:'Austin'}}]})}));assert.equal(result[0].location,'Austin');await assert.rejects(fetchBoard({type:'lever',slug:'example'},async()=>({ok:false,status:429})),/429/);});

test('job identity retains greenhouse query IDs',()=>{assert.notEqual(identity({...job,url:'https://example.com/?gh_jid=1'}),identity({...job,url:'https://example.com/?gh_jid=2'}));});
test('unknown salary cannot match',()=>{assert.equal(evaluate({...job,compensation:null},config).disposition,'review');});
test('unconfigured salary and unrelated legal leadership never enter the match queue',()=>{
 assert.equal(evaluate(job,{...config,minAnnualBaseUsd:null}).disposition,'review');
 assert.equal(evaluate({...job,title:'Vice President, Deputy General Counsel, Product'}, {...config,titleLevels:['Vice President']}).disposition,'review');
});

test('excluded employers and base floors stay out of match set',()=>{
 assert.equal(evaluate({...job,company:'Excluded'}, {...config,excludeEmployers:['Excluded']}).disposition,'review');
 assert.equal(evaluate({...job,compensation:{min:180000,currency:'USD',interval:'year'}},config).disposition,'review');
});
