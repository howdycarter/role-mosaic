import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { home,read,write } from './store.js';
import { evaluate,historyMatch } from './core.js';
import { starterSearch } from './onboarding.js';
import { approvePackets,configureStandingAuthorization } from './applications.js';
import {MosaicWorker} from './worker.js';
import {syncNotion} from './notion-sync.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {prepareQualityPackets,refreshPacket,packetHtml} from './packets.js';
import {roleTrack} from './quality.js';
const token=randomBytes(32).toString('hex');
let busy=false, lastRun=null;
const worker=new MosaicWorker({home});
const runWorker=work=>{work.catch(()=>{});};
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw Error('Request too large')}try{return JSON.parse(raw||'{}')}catch{throw Error('Malformed JSON request')}}
const server=http.createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try {
  if(req.headers.host!==`127.0.0.1:${server.address().port}`) return send(403,{error:'Local access only'});
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});res.end((await readFile(new URL('../web/index.html',import.meta.url),'utf8')).replace('__TOKEN__',token));return;}
  if(req.method==='GET'&&req.url.startsWith('/api/packet?')){const id=new URL(req.url,'http://'+req.headers.host).searchParams.get('id');if(!/^[a-f0-9]{64}$/.test(id||''))return send(400,{error:'Invalid packet identifier'});let html;try{html=packetHtml(await refreshPacket(home,JSON.parse(await readFile(path.join(home,'packets',id+'.json'),'utf8'))))}catch(e){if(e.code==='ENOENT')return send(404,{error:'Packet not found'});throw e}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(html);return;}
  if(req.method==='GET'&&req.url==='/api/state') {
   const [jobs,config,history,resume,connections,career,applicationPlan,applicationLedger]=await Promise.all([read('jobs.json',[]),read('search.json',starterSearch),read('history.json',[]),read('notion-resume.json',null),read('connections.json',{}),read('career-history.json',null),read('application-plan.json',{packets:[],held:[]}),read('application-ledger.json',[])]);
   const approvals=await read('application-approvals.json',[]),notion=await read('notion-connection.json',{}),policy=await read('application-policy.json',{});
   const quality=await read('quality-packets.json',{packets:[],evidenceIssues:[]}),submissionMode=policy.submissionMode==='automatic'?'automatic':'manual';
   quality.packets=await Promise.all(quality.packets.map(p=>refreshPacket(home,p,{jobs,config,history,ledger:applicationLedger})));
   return send(200,{jobs:jobs.map(({description,...j})=>({...j,track:roleTrack(j.title),fit:evaluate(j,config),previous:!!historyMatch(j,history)})).sort((a,b)=>b.fit.score-a.fit.score),qualityPackets:quality.packets.map(p=>({id:p.id,job:p.job,track:p.quality.track,ready:p.quality.ready,reasons:p.quality.reasons,missingRequirements:p.quality.missingRequirements,resume:p.quality.resume,proofCount:p.proofPoints.length,caseStudyCount:p.caseStudies.length})),evidenceIssues:quality.evidenceIssues||[],submissionMode,config,resume,career,authorizationMode:policy.authorizationMode||'per-posting-packet',boards:connections.boards||[],historyCount:history.length,busy:busy||worker.running,lastRun,worker:worker.status,workerConfig:await worker.config(),notion:{mode:notion.enabled?'direct integration':'saved snapshot',pageId:notion.pageId||null},applications:{packets:applicationPlan.packets.filter(p=>!applicationLedger.some(a=>a.packetDigest===p.digest)).map(p=>({id:p.id,company:p.job.company,title:p.job.title,url:p.job.url,salary:p.salary,resumeFilename:p.resumeFilename,fields:p.fields,answersPreview:p.answersPreview||[],expiresAt:p.expiresAt,approved:approvals.some(a=>a.approved&&a.packetDigest===p.digest&&Date.parse(a.expiresAt)>Date.now())})),held:applicationPlan.held,attempts:applicationLedger.map(a=>({id:a.id,company:a.company,title:a.title,status:a.status,reason:a.reason||'',createdAt:a.createdAt,canVerifyEmail:a.status==='submission_unknown'&&a.emailVerificationPending===true&&!!a.verificationCheckpoint&&!!worker.adapter?.preservedPage?.(a,{exact:true}),canResume:submissionMode==='automatic'&&a.status==='held'&&(policy.authorizationMode==='search-rules'&&policy.standingAuthorization?.enabled===true||applicationPlan.packets.some(p=>p.digest===a.packetDigest&&Date.parse(p.expiresAt)>Date.now()))}))},applicationStatus:submissionMode==='manual'?'Manual final submission. Mosaic prepares local evidence packets without filling, uploading or submitting. Existing receipts and explicitly authorized original-form verification remain available.':'Experimental automatic submission. Browser automation is detectable; current evidence, exact track PDF and authorization checks still apply. Only employer confirmation counts as submitted.'});
  }
  if(req.method==='POST') {
   if(req.headers['x-rolemosaic-token']!==token||req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Invalid local session'});
   if(req.url==='/api/worker/pause')return send(200,await worker.pause());
   if(req.url==='/api/submission-mode'){if(worker.running||busy)return send(409,{error:'Wait for the current operation'});const data=await body(req);if(!['manual','automatic'].includes(data.mode)||data.mode==='automatic'&&(data.acknowledgeAutomationRisk!==true||data.confirm!=='acknowledge-detectable-automation'))return send(400,{error:'Automatic mode requires explicit acknowledgement that browser automation is detectable'});await worker.pause();const policy=await read('application-policy.json',{});if(policy.standingAuthorization)policy.standingAuthorization.enabled=false;await write('application-policy.json',{...policy,submissionMode:data.mode,requireQualityReview:true,automationRiskAcknowledged:data.mode==='automatic',automationRiskAcknowledgedAt:data.mode==='automatic'?new Date().toISOString():null,authorizationMode:'per-posting-packet'});return send(200,{output:data.mode==='manual'?'Manual final submission selected. Automatic authorization revoked.':'Experimental native mode selected; exact résumé, evidence and application authorization are still required.'});}
   if(req.url==='/api/application-mode'){const data=await body(req);if(!['search-rules','per-posting-packet'].includes(data.mode)||data.confirm!=='current-rules-and-approved-resume')return send(400,{error:'Explicitly enable or revoke automatic applications under your current rules and approved résumé'});if((busy||worker.running)&&data.mode==='search-rules')return send(409,{error:'Wait for the current operation before enabling a new authorization scope'});return send(200,await configureStandingAuthorization({home,enabled:data.mode==='search-rules',evidence:'Applicant explicitly enabled automatic matching applications under current search rules, approved résumé, verified facts, daily limit and budget through the local dashboard'}));}
   if(busy||worker.running)return send(409,{error:'Another operation is running'});
   busy=true;
   try {
    if(req.url==='/api/prepare-packets'){const data=await body(req),r=await prepareQualityPackets({home,jobIds:data.jobIds,limit:data.limit||15});return send(200,{submissionMode:'manual',output:`Prepared ${r.packets.length} local evidence packets; nothing was sent to employers.`});}
    if(req.url==='/api/worker/start'){runWorker(worker.start());return send(202,{output:'Mosaic worker started using your configured application authorization mode.'});}
    if(req.url==='/api/worker/run'){const data=await body(req);if(data.jobIds&&(!Array.isArray(data.jobIds)||data.jobIds.length>30||data.jobIds.some(x=>typeof x!=='string')))return send(400,{error:'Invalid job selection'});worker.paused=false;runWorker(worker.cycle({jobIds:data.jobIds}));return send(202,{output:'Mosaic is searching and preparing applications in its own browser.'});}
    if(req.url==='/api/application-run'){worker.paused=false;runWorker(worker.cycle({discover:false,prepare:false,submit:true}));return send(202,{output:'Mosaic is running approved application packets.'});}
    if(req.url==='/api/application-resume'){const data=await body(req);if(typeof data.attemptId!=='string')return send(400,{error:'Choose a held attempt'});runWorker(worker.resume(data.attemptId));return send(202,{output:'Continuing the selected pre-submit draft; unknown submissions are never retried.'});}
    if(req.url==='/api/application-reconcile')return send(200,await worker.reconcileReceipts());
    if(req.url==='/api/application-verify-email'){const data=await body(req);if(data.confirm!=='complete-existing-email-verification')return send(400,{error:'Explicitly authorize completing the existing employer email verification'});return send(200,await worker.verifyEmail({attemptId:data.attemptId,code:data.code,requestId:data.requestId,evidence:data.evidence}));}
    if(req.url==='/api/application-review'){const data=await body(req);return send(200,await worker.review(data.attemptId));}
    if(req.url==='/api/notion/connect'){const data=await body(req);const result=await syncNotion({home,pageId:data.pageId,token:data.token,saveConnection:true});return send(200,result);}
    if(req.url==='/api/notion/sync')return send(200,await syncNotion({home}));
    if(req.url==='/api/discover'){
     const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.js',import.meta.url)),'discover'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,ROLEMOSAIC_HOME:home}});let output='';
     for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output=(output+b).slice(-12000));
     const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject)});lastRun={at:new Date().toISOString(),code,output};return send(code===0?200:502,lastRun);
    }
    if(req.url==='/api/application-approve'){
     let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(413,{error:'Request too large'})}
     const body=JSON.parse(raw);return send(200,await approvePackets({home,ids:body.ids}));
    }
    if(req.url==='/api/status'){
     let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(413,{error:'Request too large'})}
     const body=JSON.parse(raw);if(!['new','saved','dismissed','applied','interview','rejected','offer'].includes(body.status))return send(400,{error:'Invalid status'});
     const jobs=await read('jobs.json',[]),job=jobs.find(j=>j.id===body.id);if(!job)return send(404,{error:'Unknown job'});job.status=body.status;await write('jobs.json',jobs);return send(200,{ok:true});
    }
   }finally{busy=false;}
  }
  send(404,{error:'Not found'});
 }catch(e){send(500,{error:e.message});}
});
server.listen(Number(process.env.PORT||4317),'127.0.0.1',async()=>{console.log(`RoleMosaic: http://127.0.0.1:${server.address().port}`);try{if((await worker.config()).enabled)runWorker(worker.start());}catch(e){worker.status.state='error';worker.status.error=e.message;}});
let shuttingDown=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{
 if(shuttingDown)return;shuttingDown=true;worker.paused=true;clearInterval(worker.timer);
 const deadline=Date.now()+45000;while(worker.running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
 try{if(worker.adapter)await worker.adapter.close();}finally{server.close(()=>process.exit(0));}
});
