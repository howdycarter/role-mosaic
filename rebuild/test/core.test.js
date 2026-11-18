import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, identity, mergeJobs, historyMatch } from '../src/core.js';
import { fetchBoard } from '../src/sources.js';
const config={titleLevels:['Director','VP'],titleFields:['Product','Design','Engineering'],localCities:['Austin'],minAnnualBaseUsd:190000};
const job={title:'Director of Product',company:'Example',location:'Remote, United States',url:'https://example.com/jobs/123',seenAt:'2026-01-01',compensation:{min:200000,currency:'USD',interval:'year'}};
test('incidental product/design words do not qualify recruiting, legal or sales-engineering professions',()=>{for(const title of ['Associate Director, Talent Acquisition (Product & Design)','Director, Product Legal','Director, Sales Engineering'])assert.equal(evaluate({...job,title},config).disposition,'review');});
test('matching requires title and location evidence and excludes internships',()=>{assert.equal(evaluate(job,config).score,100); assert.equal(evaluate({...job,location:'Remote, Europe'},config).disposition,'review'); assert.equal(evaluate({...job,title:'Product Director Intern'},config).disposition,'review');});
test('refresh preserves application state and canonicalizes URL',()=>{const a=mergeJobs([],[job]);a[0].status='applied';const b=mergeJobs(a,[{...job,url:job.url+'?tracking=1',seenAt:'2026-02-01'}]);assert.equal(b.length,1);assert.equal(b[0].status,'applied');assert.equal(b[0].firstSeen,'2026-01-01');assert.equal(identity(job),identity(b[0]));});
test('history requires exact company and title or posting',()=>{assert.ok(historyMatch(job,[{company:'EXAMPLE',role:'Director of Product'}]));assert.equal(historyMatch(job,[{company:'Example',role:'VP of Product'}]),null);});
test('source rejects bad boards and maps greenhouse results',async()=>{await assert.rejects(fetchBoard({type:'greenhouse',slug:'../evil'})); const result=await fetchBoard({type:'greenhouse',slug:'example',company:'Example'},async()=>({ok:true,json:async()=>({jobs:[{title:'Director',absolute_url:'https://example.com/1',location:{name:'Austin'}}]})}));assert.equal(result[0].location,'Austin');await assert.rejects(fetchBoard({type:'lever',slug:'example'},async()=>({ok:false,status:429})),/429/);});

test('job identity retains greenhouse query IDs',()=>{assert.notEqual(identity({...job,url:'https://example.com/?gh_jid=1'}),identity({...job,url:'https://example.com/?gh_jid=2'}));});
test('legacy Greenhouse employer links use HTTPS only when bound to the same requisition',async()=>{
 const board={type:'greenhouse',slug:'example',company:'Example'};
 const fetchUrl=raw=>fetchBoard(board,async()=>Response.json({jobs:[{id:123,title:'Director',absolute_url:raw}]}));
 for(const raw of ['http://example.com/careers?gh_jid=123','http://boards.greenhouse.io/example/jobs/123']){
  assert.equal((await fetchUrl(raw))[0].url,raw.replace('http:','https:'));
 }
 for(const raw of ['http://example.com/jobs/123','http://example.com/jobs?gh_jid=321','http://example.com/jobs?gh_jid=123&gh_jid=777','http://example.com:80/jobs?gh_jid=123','http://name@example.com/jobs?gh_jid=123','http://boards.greenhouse.io/example/jobs/123?gh_jid=321']){
  await assert.rejects(fetchUrl(raw),/posting URL/);
 }
});
test('unknown salary cannot match',()=>{assert.equal(evaluate({...job,compensation:null},config).disposition,'review');});
test('only explicit nationwide labels or eligible local cities qualify',()=>{
 for(const location of ['US Remote','Fully remote in the United States','Remote (U.S. only)','Austin, TX (Hybrid)']) {
  assert.equal(evaluate({...job,location},config).disposition,'match',location);
 }
 for(const location of ['Remote US (California only)','Remote - US East Coast','Remote, nationwide','Remote US | NY only','Remote US excluding Austin','US - New York, hybrid']) {
  assert.equal(evaluate({...job,location},config).disposition,'review',location);
 }
 assert.equal(evaluate({...job,listingState:'unlisted'},config).disposition,'review');
});
test('Ashby keeps geography bound to each primary or secondary workplace',async()=>{
 const country={addressCountry:'USA'};
 const rows=[
  {location:'New York',isRemote:true,workplaceType:'Hybrid',address:{postalAddress:{...country,addressLocality:'New York'}}},
  {location:'Remote',isRemote:true,workplaceType:'Remote',address:{postalAddress:{...country,addressRegion:'California'}}},
  {location:'Toronto',isRemote:true,secondaryLocations:[{location:'New York',address:country}]},
  {location:'Remote',isRemote:true,address:{postalAddress:country}},
  {location:'Toronto',workplaceType:'Remote',secondaryLocations:[{location:'United States',address:country}]},
  {location:'Northern California',isRemote:true,secondaryLocations:[{location:'Austin, TX',address:country}]},
  {location:'Remote US',workplaceType:'OnSite'},
  {location:'United States (Remote)',workplaceType:'Remote',address:{postalAddress:{...country,addressLocality:'Boston'}}},
  {location:'Remote US',workplaceType:'Remote',descriptionPlain:'Qualifications\nApplicants must be located in California.'},
  {location:'Remote US',isListed:false},
 ];
 const fetched=await fetchBoard({type:'ashby',slug:'example',company:'Example'},async()=>Response.json({jobs:rows.map((row,i)=>({...row,id:i,title:job.title,jobUrl:'https://jobs.ashbyhq.com/example/'+i}))}));
 assert.equal(fetched.length,9);
 assert.deepEqual(fetched.map(j=>evaluate({...j,compensation:job.compensation},config).disposition),['review','review','review','match','match','match','review','match','review']);
});
test('unconfigured salary and unrelated legal leadership never enter the match queue',()=>{
 assert.equal(evaluate(job,{...config,minAnnualBaseUsd:null}).disposition,'review');
 assert.equal(evaluate({...job,title:'Vice President, Deputy General Counsel, Product'}, {...config,titleLevels:['Vice President']}).disposition,'review');
});

test('excluded employers and base floors stay out of match set',()=>{
 assert.equal(evaluate({...job,company:'Excluded'}, {...config,excludeEmployers:['Excluded']}).disposition,'review');
 assert.equal(evaluate({...job,compensation:{min:180000,currency:'USD',interval:'year'}},config).disposition,'review');
});

test('reviewed never-submitted holds are scoped to exact row bytes and posting; submitted and uncertain records always block',async()=>{
 const {reapplicationHistory}=await import('../src/core.js'),{digest}=await import('../src/applications.js');const row={company:'Example',role:'Director of Product',posting:job.url,status:'held'};
 const review={verifiedNeverSubmitted:true,historyRowSha256:digest(row),posting:job.url,reviewedAt:'2026-01-02T00:00:00Z',evidence:'Required factual answer now confirmed; original hold explicitly never submitted'};
 assert.deepEqual(reapplicationHistory(job,[row],[review]),[]);assert.deepEqual(reapplicationHistory({...job,url:job.url+'/other'},[row],[review]),[row]);
 for(const status of ['submitted','submission_unknown','unconfirmed']){const r={...row,status};assert.deepEqual(reapplicationHistory(job,[r],[{...review,historyRowSha256:digest(r)}]),[r]);}
 assert.deepEqual(reapplicationHistory(job,[{...row,note:'changed'}],[review]),[{...row,note:'changed'}]);
});

test('explicit overlapping salary bands preserve the applicant minimum and do not infer currency, period or invalid bounds',()=>{
 const overlap={...config,salaryRangeMode:'overlap'},band={min:180000,max:240000,currency:'USD',interval:'year'};
 assert.equal(evaluate({...job,compensation:band},config).disposition,'review');assert.equal(evaluate({...job,compensation:band},overlap).disposition,'match');
 assert.equal(evaluate({...job,compensation:{...band,max:185000}},overlap).disposition,'review');
 for(const change of [{currency:'CAD'},{interval:'month'},{max:170000},{max:undefined}])assert.equal(evaluate({...job,compensation:{...band,...change}},overlap).disposition,'review');
 assert.equal(evaluate(job,{...config,salaryRangeMode:'unknown'}).disposition,'review');
});

test('FDE is an opt-in target with scoped seniority and unchanged salary/location rules',()=>{
 const fde={...config,fdeTarget:{enabled:true,levels:['senior','staff','principal','lead','founding','director','head','vp'],includeUnspecifiedLevel:true}};
 for(const title of ['Senior Forward Deployed Engineer','Sr. Forward Deployed Engineer','Sr Forward Deployed Engineer','Staff Forward-Deployed Software Engineer','Principal FDE'])assert.equal(evaluate({...job,title},fde).disposition,'match',title);
 assert.equal(evaluate({...job,title:'Forward Deployed Engineer'},fde).disposition,'review');
 assert.ok(evaluate({...job,title:'Forward Deployed Engineer'},fde).matches.levels.length);
 for(const title of ['Junior Forward Deployed Engineer','Jr. Forward Deployed Engineer','Forward Deployed Engineer Intern','Senior Software Engineer','Senior Deployment Strategist','Principal Technical Program Manager, Forward Deployed Engineering'])assert.equal(evaluate({...job,title},fde).disposition,'review',title);
 assert.equal(evaluate({...job,title:'Senior FDE'},config).disposition,'review');
 assert.equal(evaluate({...job,title:'Senior FDE',location:'Remote Europe'},fde).disposition,'review');
 assert.equal(evaluate({...job,title:'Senior FDE',compensation:{min:100000,currency:'USD',interval:'year'}},fde).disposition,'review');
});
