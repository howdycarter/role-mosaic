import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,stat,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCareer,parseCsv,htmlText,addSource,boundedFile } from '../src/career.js';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
const csv='Company Name,Title,Started On,Finished On,Description,Location\r\n"Example, Inc.",Engineering Lead,2020,2023,"Led delivery\nwith a team",Remote\r\nContract Studio,Designer,2021,,"Kept overlapping role",Austin';
test('positions CSV retains quoted commas, newlines, overlapping roles and unknown dates',()=>{
 const source=parseCareer('Positions.csv',Buffer.from(csv));
 assert.equal(source.roles.length,2);assert.equal(source.roles[0].company,'Example, Inc.');
 assert.equal(source.roles[0].description,'Led delivery\nwith a team');assert.equal(source.roles[1].startDate,'2021');assert.equal(source.roles[1].endDate,'');
 assert.equal(source.sha256.length,64);assert.equal(source.id,source.sha256);
 assert.throws(()=>parseCsv('"unterminated'),/Unclosed/);
 assert.throws(()=>parseCareer('bad.csv',Buffer.from('company,title\nA,B,C')),/row length/);
 assert.throws(()=>parseCareer('bad.json',Buffer.from('[{"company":"A","title":4}]')),/string/);
});
test('saved HTML becomes inert evidence without scripts, forms or outbound resources',()=>{
 const text=htmlText('<script>steal()</script><nav>Menu</nav><form>password</form><h1>A &amp; B</h1><p>Lead &#x26; mentor</p><img src="https://example.invalid/x">');
 assert.equal(text,'A & B\nLead & mentor');
 assert.equal(parseCareer('own.html',Buffer.from('<h1>Engineer</h1>')).text,'Engineer');
 assert.throws(()=>parseCareer('own.pdf',Buffer.from('%PDF-')),/Supported/);
 assert.throws(()=>parseCareer('own.md',Buffer.from([255,0])),/encoded data/);
 const source=parseCareer('notes.txt',Buffer.from('Career notes'));
 const first=addSource({sources:[]},source);assert.equal(addSource(first,source),first);
 assert.equal(first.reviewStatus,'needs-review');
 assert.throws(()=>addSource({sources:Array.from({length:20},(_,i)=>({...source,id:String(i)}))},source),/limited/);
});
test('resume-less setup, repeated imports, private review, preserved notes, PDF attachment work without credentials',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-career-'));
 try {
  const home=path.join(root,'private'), file=path.join(root,'Positions.csv');await writeFile(file,csv);
  const run=args=>spawnSync(process.execPath,[cli,...args],{env:{...process.env,ROLEMOSAIC_HOME:home,OPENROUTER_API_KEY:'',ANTHROPIC_API_KEY:''},encoding:'utf8'});
  let result=run(['init','--career',file]);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(await readFile(path.join(home,'connections.json'),'utf8')).resume,null);
  const source=JSON.parse(await readFile(path.join(home,'career-history.json'),'utf8'));
  assert.equal(source.sources.length,1);assert.equal(source.sources[0].roles.length,2);
  await writeFile(path.join(home,'career-notes.md'),'My reviewed notes stay here');
  result=run(['import-career','--file',file]);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Duplicate skipped/);
  const md=path.join(root,'own.md');await writeFile(md,'<img src=x onerror=alert(1)>\nMissing date remains unknown');
  assert.equal(run(['import-career','--file',md,'--label','My notes']).status,0);
  const html=await readFile(path.join(home,'career-review.html'),'utf8');
  assert.match(html,/My reviewed notes stay here/);assert.match(html,/&lt;img src=x/);assert.doesNotMatch(html,/<img src=x/);
  for(const name of ['career-history.json','career-notes.md','career-review.html'])assert.equal((await stat(path.join(home,name))).mode&0o777,0o600);
  assert.equal(run(['status']).status,0);
  const pdf=path.join(root,'own.pdf');await writeFile(pdf,'%PDF-1.4\nfixture');
  assert.equal(run(['attach-resume','--file',pdf]).status,0);
  assert.notEqual(run(['attach-resume','--file',pdf]).status,0);
  assert.equal(JSON.parse(await readFile(path.join(home,'connections.json'),'utf8')).resume,path.join(home,'resume.pdf'));
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('blank setup provides worksheet and malformed or oversized imports preserve existing data',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mosaic-career-invalid-'));
 try {
  const home=path.join(root,'private');
  const run=args=>spawnSync(process.execPath,[cli,...args],{env:{...process.env,ROLEMOSAIC_HOME:home},encoding:'utf8'});
  assert.equal(run(['init']).status,0);
  assert.match(await readFile(path.join(home,'career-notes.md'),'utf8'),/EVERY role/);
  const before=await readFile(path.join(home,'career-history.json'),'utf8');
  const invalid=path.join(root,'bad.csv');await writeFile(invalid,'a,b\n1,2');
  assert.notEqual(run(['import-career','--file',invalid]).status,0);
  assert.equal(await readFile(path.join(home,'career-history.json'),'utf8'),before);
  const large=path.join(root,'large.txt');await writeFile(large,'a'.repeat(2*1024*1024+1));
  await assert.rejects(boundedFile(large),/2 MiB/);
  await assert.rejects(boundedFile(root),/regular file/);
 } finally { await rm(root,{recursive:true,force:true}); }
});
