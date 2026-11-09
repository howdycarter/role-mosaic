import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const steps=[['npm',['run','check-types'],root],['npm',['test'],root],['npm',['run','test:rebuild'],root],['npm',['run','test:browser'],root+'/rebuild'],['npm',['run','check:privacy'],root],['npm',['audit','--omit=dev','--audit-level=high'],root],['npm',['audit','--omit=dev','--audit-level=high'],root+'/rebuild']];
for(const [command,args,cwd] of steps){console.log('\nLocal check: '+command+' '+args.join(' '));const result=spawnSync(command,args,{cwd,stdio:'inherit',env:{...process.env,MOSAIC_TEST_CHANNEL:process.env.MOSAIC_TEST_CHANNEL||(process.platform==='darwin'?'chrome':'')}});if(result.status!==0)process.exit(result.status||1);}
console.log('\nLocal verification passed. No cloud build or deployment was requested.');
