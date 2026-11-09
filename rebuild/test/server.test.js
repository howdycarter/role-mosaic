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
  const page=await fetch(url);assert.ok((await page.text()).includes('Career history'));
  assert.equal((await fetch(url+'/api/status',{method:'POST',body:'{}'})).status,403);
 }finally{child.kill();await rm(dir,{recursive:true,force:true})}
});

test('dashboard renders a new applicant with no salary floor or resume without a script error',async()=>{
 const {readFile}=await import('node:fs/promises');const {runInNewContext}=await import('node:vm');
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 const nodes=new Map();
 const node=()=>({value:'',textContent:'',style:{},replaceChildren(){},append(){},setAttribute(){}});
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},createElement:node};
 document.getElementById('track').value='all';document.getElementById('message');
 const state={jobs:[],historyCount:0,boards:[],config:{titleLevels:['director'],titleFields:['design'],localCities:[],minAnnualBaseUsd:null},career:{sources:[{label:'Own notes',text:'<script>untrusted source</script>'}]},resume:null,applicationStatus:'No submissions'};
 runInNewContext(script,{document,fetch:async()=>({ok:true,json:async()=>state})});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes.get('message').textContent,'');
 assert.match(nodes.get('rules').textContent,/Not configured/);
 assert.match(nodes.get('resumeText').textContent,/<script>untrusted source/);
 assert.equal(nodes.get('notionLink').hidden,true);
});
