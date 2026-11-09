import {mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';

export async function buildLocalRuntime({root,destination}){
 const source=path.join(root,'rebuild'),target=path.join(destination,'rebuild');
 // A separate runtime copy is built locally. Never package private applicant
 // state, the repository's .env, git metadata, tests, or unrelated directories.
 await mkdir(destination,{recursive:false,mode:0o700});await mkdir(target,{mode:0o700});
 for(const name of ['src','web','package.json','package-lock.json','node_modules'])await cp(path.join(source,name),path.join(target,name),{recursive:true,errorOnExist:true,force:false});
 const hashes={};
 const walk=async dir=>{for(const entry of await readdir(path.join(target,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile())hashes[file]=createHash('sha256').update(await readFile(path.join(target,file))).digest('hex');}};
 await walk('src');await walk('web');
 const manifest={builtAt:new Date().toISOString(),nodeVersion:process.version,files:hashes};
 manifest.sourceDigest=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
 await writeFile(path.join(target,'build.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});return {runtimeRoot:destination,manifest};
}
