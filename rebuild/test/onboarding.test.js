import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../src/cli.js',import.meta.url));
test('new applicants initialize from their own PDF without legacy or fictional profile data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mosaic-setup-'));
 try{
  const resume=path.join(root,'own.pdf'),home=path.join(root,'workspace');
  await writeFile(resume,'%PDF-1.4\nsynthetic test fixture');
  const run=(args)=>spawnSync(process.execPath,[cli,...args],{env:{...process.env,ROLEMOSAIC_HOME:home},encoding:'utf8'});
  assert.equal(run(['init','--resume',resume]).status,0);
  const c=JSON.parse(await readFile(path.join(home,'connections.json'),'utf8'));
  assert.equal(c.resume,path.join(home,'resume.pdf'));assert.equal(c.profile,null);assert.deepEqual(c.boards,[]);
  assert.equal(JSON.parse(await readFile(path.join(home,'search.json'),'utf8')).minAnnualBaseUsd,null);
  assert.deepEqual(JSON.parse(await readFile(path.join(home,'history.json'),'utf8')),[]);
  assert.equal((await stat(c.resume)).mode&0o777,0o600);
  assert.notEqual(run(['init','--resume',resume]).status,0);
  const before=await readFile(c.resume,'utf8');assert.match(before,/synthetic/);
  const md=path.join(root,'career.md');await writeFile(md,'My own career history');
  assert.notEqual(run(['connect-notion','--file',md,'--url','https://notion.so.attacker.test/page']).status,0);
  assert.equal(run(['connect-notion','--file',md,'--url','https://www.notion.so/example-page']).status,0);
  const snapshot=JSON.parse(await readFile(path.join(home,'notion-resume.json'),'utf8'));
  assert.equal(snapshot.text,'My own career history');assert.equal(snapshot.approved,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('invalid setup input is rejected before applicant storage is created',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mosaic-invalid-'));
 try{
  const resume=path.join(root,'fake.pdf'),home=path.join(root,'workspace');await writeFile(resume,'not a PDF');
  const result=spawnSync(process.execPath,[cli,'init','--resume',resume],{env:{...process.env,ROLEMOSAIC_HOME:home},encoding:'utf8'});
  assert.notEqual(result.status,0);await assert.rejects(stat(home),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('setup refuses a workspace containing another applicants job records',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'mosaic-preserve-'));
 try{
  const resume=path.join(root,'own.pdf'),home=path.join(root,'workspace');
  await writeFile(resume,'%PDF-1.4\nsynthetic test fixture');await mkdir(home);
  await writeFile(path.join(home,'jobs.json'),'["existing private record"]');
  const result=spawnSync(process.execPath,[cli,'init','--resume',resume],{env:{...process.env,ROLEMOSAIC_HOME:home},encoding:'utf8'});
  assert.notEqual(result.status,0);assert.equal(await readFile(path.join(home,'jobs.json'),'utf8'),'["existing private record"]');
  await assert.rejects(stat(path.join(home,'resume.pdf')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
