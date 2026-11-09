import {test} from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm,stat}from'node:fs/promises';import os from'node:os';import path from'node:path';import{buildLocalRuntime}from'../../scripts/build-local-runtime.mjs';
test('local runtime packaging copies only runtime assets and records source hashes, excluding private applicant state',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'mosaic-package-')),root=path.join(base,'source'),destination=path.join(base,'release');
 try{
  for(const dir of ['src','web','node_modules','private'])await mkdir(path.join(root,'rebuild',dir),{recursive:true});
  for(const [file,text]of[['src/server.js','export const ownRuntime=true;'],['web/index.html','own dashboard'],['package.json','{"type":"module"}'],['package-lock.json','{}'],['private/credentials.json','never package this']])await writeFile(path.join(root,'rebuild',file),text);
  const result=await buildLocalRuntime({root,destination});assert.equal(result.runtimeRoot,destination);assert.equal(await readFile(path.join(destination,'rebuild/src/server.js'),'utf8'),'export const ownRuntime=true;');
  await assert.rejects(stat(path.join(destination,'rebuild/private')),e=>e.code==='ENOENT');assert.equal(result.manifest.files['src/server.js'].length,64);assert.equal(result.manifest.sourceDigest.length,64);
  await assert.rejects(buildLocalRuntime({root,destination}),e=>e.code==='EEXIST');
 }finally{await rm(base,{recursive:true,force:true});}
});
