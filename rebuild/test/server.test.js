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
  const health=await fetch(url+'/api/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',submissionMode:'manual',applicationEnabled:false,workerEnabled:false,workerRunning:false,recordsValid:true});
  const state=await fetch(url+'/api/state');assert.equal(state.status,200);const data=await state.json();assert.deepEqual(data.jobs,[]);assert.equal(data.submissionMode,'manual');
  assert.equal((await fetch(url+'/api/packet?id=../application-policy')).status,400);
  const html=await(await fetch(url)).text(),token=html.match(/const token='([^']+)'/)[1],headers={'Content-Type':'application/json','Origin':url,'X-Rolemosaic-Token':token};
  const prepared=await fetch(url+'/api/prepare-packets',{method:'POST',headers,body:'{}'});assert.equal(prepared.status,200);assert.equal((await prepared.json()).submissionMode,'manual');
  assert.equal((await fetch(url+'/api/submission-mode',{method:'POST',headers,body:JSON.stringify({mode:'automatic'})})).status,400);

  const {ApplicationStore}=await import('../src/applications.js'),{seedQuality}=await import('./helpers/quality-fixture.js'),{prepareQualityPackets}=await import('../src/packets.js'),store=new ApplicationStore(dir),job={id:'r',company:'Example',title:'Director Product',description:'Product delivery',location:'Remote US',url:'https://example.invalid/job',compensation:{min:210000,max:250000,currency:'USD',interval:'year'}};
  await store.write('jobs.json',[job]);await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:190000});await writeFile(path.join(dir,'own.pdf'),'%PDF-1.4 synthetic');await seedQuality(dir,job,path.join(dir,'own.pdf'));const packet=(await prepareQualityPackets({home:dir,jobIds:['r']})).packets[0];assert.equal((await(await fetch(url+'/api/state')).json()).qualityPackets[0].ready,true);
  await writeFile(path.join(dir,'synthetic-evidence.txt'),'Source changed');const changed=await(await fetch(url+'/api/state')).json();assert.equal(changed.qualityPackets[0].ready,false);assert.equal(changed.qualityPackets[0].proofCount,0);const staleHtml=await(await fetch(url+'/api/packet?id='+packet.id)).text();assert.match(staleHtml,/Stale — regenerate/);assert.equal(staleHtml.includes('Synthetic product, design and engineering delivery example.'),false);
  const page=await fetch(url);assert.ok((await page.text()).includes('Career history'));
  assert.equal((await fetch(url+'/api/status',{method:'POST',body:'{}'})).status,403);
  await writeFile(path.join(dir,'application-ledger.json'),'invalid private record');const failed=await fetch(url+'/api/health');assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{status:'error',recordsValid:false});
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
