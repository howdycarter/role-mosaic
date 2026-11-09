import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { read,write } from './store.js';
import { evaluate,historyMatch } from './core.js';
const token=randomBytes(32).toString('hex');
let busy=false, lastRun=null;
const server=http.createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try {
  if(req.headers.host!==`127.0.0.1:${server.address().port}`) return send(403,{error:'Local access only'});
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});res.end((await readFile(new URL('../web/index.html',import.meta.url),'utf8')).replace('__TOKEN__',token));return;}
  if(req.method==='GET'&&req.url==='/api/state') {
   const [jobs,config,history,resume,connections]=await Promise.all([read('jobs.json',[]),read('search.json',{}),read('history.json',[]),read('notion-resume.json',null),read('connections.json',{})]);
   return send(200,{jobs:jobs.map(({description,...j})=>({...j,fit:evaluate(j,config),previous:!!historyMatch(j,history)})).sort((a,b)=>b.fit.score-a.fit.score),config,resume,boards:connections.boards||[],historyCount:history.length,busy,lastRun,applicationStatus:'Blocked: résumé approval and browser submission adapter require verification'});
  }
  if(req.method==='POST') {
   if(req.headers['x-rolemosaic-token']!==token||req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Invalid local session'});
   if(busy)return send(409,{error:'Another operation is running'});
   busy=true;
   try {
    if(req.url==='/api/discover'){
     const child=spawn(process.execPath,[new URL('./cli.js',import.meta.url).pathname,'discover'],{cwd:new URL('..',import.meta.url).pathname});let output='';
     for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output=(output+b).slice(-12000));
     const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject)});lastRun={at:new Date().toISOString(),code,output};return send(code===0?200:502,lastRun);
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
