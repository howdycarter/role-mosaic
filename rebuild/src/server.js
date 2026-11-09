import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { home,read,write } from './store.js';
import { evaluate,historyMatch } from './core.js';
import { starterSearch } from './onboarding.js';
import { approvePackets } from './applications.js';
import { fileURLToPath } from 'node:url';
const token=randomBytes(32).toString('hex');
let busy=false, lastRun=null;
const server=http.createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try {
  if(req.headers.host!==`127.0.0.1:${server.address().port}`) return send(403,{error:'Local access only'});
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});res.end((await readFile(new URL('../web/index.html',import.meta.url),'utf8')).replace('__TOKEN__',token));return;}
  if(req.method==='GET'&&req.url==='/api/state') {
   const [jobs,config,history,resume,connections,career,applicationPlan,applicationLedger]=await Promise.all([read('jobs.json',[]),read('search.json',starterSearch),read('history.json',[]),read('notion-resume.json',null),read('connections.json',{}),read('career-history.json',null),read('application-plan.json',{packets:[],held:[]}),read('application-ledger.json',[])]);
   return send(200,{jobs:jobs.map(({description,...j})=>({...j,fit:evaluate(j,config),previous:!!historyMatch(j,history)})).sort((a,b)=>b.fit.score-a.fit.score),config,resume,career,boards:connections.boards||[],historyCount:history.length,busy,lastRun,applications:{packets:applicationPlan.packets.filter(p=>!applicationLedger.some(a=>a.packetDigest===p.digest)).map(p=>({id:p.id,company:p.job.company,title:p.job.title,url:p.job.url,salary:p.salary,resumeFilename:p.resumeFilename,fields:p.fields,answersPreview:p.answersPreview||[],expiresAt:p.expiresAt})),held:applicationPlan.held.length,attempts:applicationLedger.map(a=>({company:a.company,title:a.title,status:a.status,reason:a.reason||'',createdAt:a.createdAt}))},applicationStatus:'Prepared applications require exact résumé/profile authorization. The connected Browser driver fills and submits supported forms; CAPTCHA, accounts and uncertain outcomes are held.'});
  }
  if(req.method==='POST') {
   if(req.headers['x-rolemosaic-token']!==token||req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Invalid local session'});
   if(busy)return send(409,{error:'Another operation is running'});
   busy=true;
   try {
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
server.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log(`RoleMosaic: http://127.0.0.1:${server.address().port}`));
