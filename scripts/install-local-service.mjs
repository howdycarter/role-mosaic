import {mkdir,writeFile,chmod,readFile,rename,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {buildLocalRuntime} from './build-local-runtime.mjs';
if(process.platform!=='darwin'||!process.argv.includes('--install'))throw Error('macOS only. Review the local service, then run with --install.');
const root=fileURLToPath(new URL('..',import.meta.url)),home=path.resolve(process.env.ROLEMOSAIC_HOME||path.join(root,'rebuild/private')),port=Number(process.env.PORT||4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a valid local port');
const directory=path.join(os.homedir(),'Library/LaunchAgents'),file=path.join(directory,'com.rolemosaic.local.plist');
let existing=false;try{await access(file);existing=true;}catch(e){if(e.code!=='ENOENT')throw e;}
if(existing&&!process.argv.includes('--update'))throw Error('Mosaic service already installed; use --install --update after local verification.');
if(existing){if(!(await readFile(file,'utf8')).includes('<string>com.rolemosaic.local</string>'))throw Error('Existing service identity differs');for(const name of ['worker-run.lock','application-run.lock']){try{await access(path.join(home,name));throw Error('Wait for the current application run before updating the service')}catch(e){if(e.code!=='ENOENT')throw e;}}}
await mkdir(directory,{recursive:true});await mkdir(home,{recursive:true,mode:0o700});await chmod(home,0o700);
const releases=path.join(os.homedir(),'Library/Application Support/RoleMosaic/releases');await mkdir(releases,{recursive:true,mode:0o700});
const {runtimeRoot}=await buildLocalRuntime({root,destination:path.join(releases,new Date().toISOString().replace(/[:.]/g,'-'))});
if(existing){const stopped=spawnSync('launchctl',['bootout','gui/'+process.getuid()+'/com.rolemosaic.local'],{stdio:'inherit'});if(stopped.status!==0)throw Error('Could not stop existing Mosaic service; runtime copy preserved');await rename(file,file+'.backup-'+Date.now());}
const log=path.join(home,'service.log');await writeFile(log,'',{flag:'a',mode:0o600});await chmod(log,0o600);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const xml=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.rolemosaic.local</string><key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(path.join(runtimeRoot,'rebuild/src/server.js'))}</string></array><key>WorkingDirectory</key><string>${escape(path.join(runtimeRoot,'rebuild'))}</string><key>EnvironmentVariables</key><dict><key>ROLEMOSAIC_HOME</key><string>${escape(home)}</string><key>PORT</key><string>${port}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${escape(log)}</string><key>StandardErrorPath</key><string>${escape(log)}</string></dict></plist>`;
await writeFile(file,xml,{mode:0o600,flag:'wx'});await chmod(file,0o600);
// bootout can return before launchd releases its previous job. Retry only this
// local registration, bounded to five seconds; never retry an application.
let result;
for(let attempt=0;attempt<10;attempt++){
 result=spawnSync('launchctl',['bootstrap','gui/'+process.getuid(),file],{encoding:'utf8'});
 if(result.status===0)break;
 if(!existing||!String(result.stderr).includes('5: Input/output error'))break;
 await new Promise(r=>setTimeout(r,500));
}
if(result.status!==0)throw Error('Service registration failed; the built runtime and prior service backup are preserved. Inspect launchctl and service.log.');
console.log('Mosaic local login service installed: http://127.0.0.1:'+port);console.log('Stop service: launchctl bootout gui/'+process.getuid()+'/com.rolemosaic.local');
