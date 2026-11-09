import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
test('local app serves state and refuses unauthorized writes',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'rolemosaic-'));
 const child=spawn(process.execPath,[new URL('../src/server.js',import.meta.url).pathname],{env:{...process.env,ROLEMOSAIC_HOME:dir,PORT:'0'}});
 try{
  const url=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=String(b).match(/http:\/\/127.0.0.1:\d+/);if(m)resolve(m[0])});child.on('error',reject);child.on('exit',()=>reject(Error('Server exited')))});
  const state=await fetch(url+'/api/state');assert.equal(state.status,200);assert.deepEqual((await state.json()).jobs,[]);
  const page=await fetch(url);assert.ok((await page.text()).includes('Notion résumé'));
  assert.equal((await fetch(url+'/api/status',{method:'POST',body:'{}'})).status,403);
 }finally{child.kill();await rm(dir,{recursive:true,force:true})}
});
