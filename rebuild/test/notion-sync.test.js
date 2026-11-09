import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ApplicationStore} from '../src/applications.js';import {syncNotion,notionPageId} from '../src/notion-sync.js';
test('direct Notion sync keeps credentials private, imports nested text and never approves applicant claims',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-notion-')),store=new ApplicationStore(home),id='123456781234123412341234567890ab';let calls=0;
 try{
  const fetcher=async(url,options)=>{assert.ok(url.startsWith('https://api.notion.com/v1/'));assert.equal(options.headers['Notion-Version'],'2026-03-11');calls++;return new Response(JSON.stringify(url.includes('/pages/')?{url:'https://www.notion.so/'+id,properties:{title:{type:'title',title:[{plain_text:'Own history'}]}}}:{results:[{id,type:'paragraph',paragraph:{rich_text:[{plain_text:'Own verified source notes'}]},has_children:false}],has_more:false}),{status:200});};
  const result=await syncNotion({home,pageId:id,token:'synthetic-test-token',fetcher,saveConnection:true});
  assert.equal(result.approved,false);assert.equal(calls,2);assert.equal((await store.read('notion-credentials.json')).token,'synthetic-test-token');
  const snapshot=await store.read('notion-resume.json');assert.equal(snapshot.approved,false);assert.ok(!JSON.stringify(snapshot).includes('synthetic-test-token'));
  assert.throws(()=>notionPageId('https://attacker.invalid/'),/page ID/);
  const original=structuredClone(snapshot);await assert.rejects(syncNotion({home,fetcher:async()=>new Response('',{status:401})}),/HTTP 401/);assert.deepEqual(await store.read('notion-resume.json'),original);
 }finally{await rm(home,{recursive:true,force:true});}
});
