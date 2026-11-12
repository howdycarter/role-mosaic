import {open,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {ApplicationStore,prepareApplications,runApplications,reconcileApplications,postingKey,authorizationMatches,standingAuthorizationMatches,supportedPosting,individualContributorReviewed,continueApplicationVerification} from './applications.js';
import {evaluate,mergeJobs,historyMatch,reapplicationHistory} from './core.js';
import {fetchBoard} from './sources.js';
import {campaignProgress} from './campaign.js';
import {prepareQualityPackets} from './packets.js';

export const workerDefaults={enabled:false,intervalMinutes:30,maxInspections:15,headless:false,channel:'chrome',autoSubmitApproved:true};
export class MosaicWorker {
 constructor({home,adapterFactory,fetcher=fetch}={}){
  this.home=home;this.store=new ApplicationStore(home);this.fetcher=fetcher;
  this.adapterFactory=adapterFactory|| (async config=>{const {PlaywrightApplicationAdapter}=await import('./playwright-adapter.js');return PlaywrightApplicationAdapter.launch({home,...config});});
  this.adapter=null;this.timer=null;this.running=false;this.paused=false;this.status={state:'stopped',transport:'playwright',lastRun:null,error:null};
 }
 async config(){const c={...workerDefaults,...await this.store.read('worker.json',{})};if(!Number.isFinite(c.intervalMinutes)||c.intervalMinutes<1||c.intervalMinutes>1440||!Number.isInteger(c.maxInspections)||c.maxInspections<1||c.maxInspections>30||!['chrome','chromium'].includes(c.channel))throw Error('Invalid worker configuration');return c;}
 async browser(){if(!this.adapter){if(!this.adapterPromise)this.adapterPromise=this.config().then(c=>this.adapterFactory(c));try{this.adapter=await this.adapterPromise;}finally{this.adapterPromise=null;}}return this.adapter;}
 async persist(){await this.store.write('worker-state.json',this.status);}
 async canContinue(){this.status.campaign=await campaignProgress({home:this.home});return !this.paused&&!this.status.campaign.complete;}
 async stopAtTarget(){
  this.status.campaign=await campaignProgress({home:this.home});
  if(!this.status.campaign.complete)return false;
  await this.pause();this.status.state='complete';this.status.stage='campaign target reached';return true;
 }
 async start(){const c=await this.config();this.paused=false;await this.store.write('worker.json',{...c,enabled:true});clearInterval(this.timer);this.timer=setInterval(()=>{this.cycle().catch(()=>{});},c.intervalMinutes*60000);this.timer.unref?.();this.status.state='idle';await this.persist();return this.cycle();}
 async pause(){this.paused=true;clearInterval(this.timer);this.timer=null;await this.store.write('worker.json',{...await this.config(),enabled:false});this.status.pauseRequested=this.running;this.status.state=this.running?'pausing':'paused';await this.persist();return this.status;}
 async stop(){await this.pause();if(this.running)throw Error('Worker is finishing its current operation; browser preserved');if(this.adapter)await this.adapter.close();this.adapter=null;}
 async discover(){
  const connections=await this.store.read('connections.json',{}),boards=connections.boards||[];
  if(!boards.length)throw Error('No employer boards configured');
  const successes=[],failures=[];
  // Bounded concurrency; a failing source cannot erase saved jobs.
  for(let offset=0;offset<boards.length;offset+=4){
   if(this.paused)break;
   const batch=boards.slice(offset,offset+4),results=await Promise.allSettled(batch.map(b=>fetchBoard(b,this.fetcher)));
   results.forEach((r,i)=>r.status==='fulfilled'?successes.push(...r.value):failures.push({source:batch[i].type+'/'+batch[i].slug,reason:String(r.reason).slice(0,160)}));
  }
  if(!successes.length&&failures.length)throw Error('All employer sources failed; saved jobs preserved');
  const jobs=mergeJobs(await this.store.read('jobs.json',[]),successes);await this.store.write('jobs.json',jobs);
  this.status.discovery={at:new Date().toISOString(),boards:boards.length,fetched:successes.length,saved:jobs.length,failures};await this.persist();
 }
 async cycle({discover=true,prepare=true,submit=true,jobIds}={}){
  if(this.running)throw Error('Worker already running');
  const lock=path.join(this.home,'worker-run.lock');let handle;
  try{handle=await open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another worker owns this workspace; inspect its state before recovery');throw e;}
  this.running=true;this.status={...this.status,state:'running',stage:'starting',error:null,startedAt:new Date().toISOString()};await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:this.status.startedAt}));await handle.close();
  try{
   const config=await this.config();await this.persist();
   if(await this.stopAtTarget())return this.status;
   const notion=await this.store.read('notion-connection.json',{});
   if(notion.enabled&&!this.paused){this.status.stage='Notion sync';await this.persist();const {syncNotion}=await import('./notion-sync.js');this.status.notion=await syncNotion({home:this.home,fetcher:this.fetcher});}
   if(discover&&!this.paused){this.status.stage='discovery';await this.persist();await this.discover();}
   if(this.paused){this.status.state='paused';this.status.stage='paused before application work';return this.status;}
   const executionPolicy=await this.store.read('application-policy.json',{});
   if(executionPolicy.submissionMode!=='automatic'){
    this.status.stage='preparing local evidence packets';this.status.submissionMode='manual';await this.persist();
    const result=prepare?await prepareQualityPackets({home:this.home,jobIds,limit:config.maxInspections}):await this.store.read('quality-packets.json',{packets:[]});
    this.status.qualityPackets={count:result.packets.length,ready:result.packets.filter(p=>p.quality.ready).length};this.status.plan={prepared:this.status.qualityPackets.ready,held:result.packets.filter(p=>!p.quality.ready).map(p=>({id:p.job.id,company:p.job.company,title:p.job.title,reason:p.quality.reasons.join('; ')}))};this.status.state='idle';this.status.stage='finished';this.status.lastRun=new Date().toISOString();return this.status;
   }
   if(executionPolicy.automationRiskAcknowledged!==true)throw Error('Automatic browser submission requires explicit acknowledgement that automation is detectable');
   const adapter=await this.browser();
   this.status.stage='reconciliation';await this.persist();
   // Never fill or re-submit unknown attempts. The adapter uses preserved pages.
   this.status.reconciled=await reconcileApplications({home:this.home,adapter});
   let plan=await this.store.read('application-plan.json',{packets:[],held:[]});
   let ledger=await this.store.read('application-ledger.json',[]);
   const now=new Date(),approvals=await this.store.read('application-approvals.json',[]),policy=await this.store.read('application-policy.json',{});
   const authorized=plan.packets.filter(p=>Date.parse(p.expiresAt)>now.getTime()&&!ledger.some(a=>a.packetDigest===p.digest)&&(standingAuthorizationMatches(policy,p,adapter)||approvals.some(a=>authorizationMatches(a,p,now))));
   if(submit&&config.autoSubmitApproved&&authorized.length&&!this.paused){
    this.status.stage='approved applications';await this.persist();
    // One packet at a time permits Pause between applications. Engine writes
    // durable submission_unknown BEFORE its only final submission click.
    for(const packet of authorized){if(!await this.canContinue())break;await runApplications({home:this.home,adapter,packetIds:[packet.id],shouldContinue:()=>this.canContinue()});}
   }
   if(await this.stopAtTarget())return this.status;
   ledger=await this.store.read('application-ledger.json',[]);
   const pending=plan.packets.filter(p=>Date.parse(p.expiresAt)>Date.now()&&!ledger.some(a=>a.packetDigest===p.digest));
   if(prepare&&!pending.length&&!this.paused){
    this.status.stage='preparing applications';await this.persist();
    const [jobs,search,history,seen]=await Promise.all([this.store.read('jobs.json',[]),this.store.read('search.json',{}),this.store.read('history.json',[]),this.store.read('worker-inspected.json',{})]);
    const reviews=await this.store.read('reapplication-reviews.json',[]);
    const candidates=jobs.filter(j=>{
     const blockingHistory=reapplicationHistory(j,history,reviews);
     if(!supportedPosting(j.url))return false;
     if(jobIds&&!jobIds.includes(j.id))return false;
     if(['applied','dismissed','rejected'].includes(j.status)||historyMatch(j,blockingHistory)||ledger.some(a=>a.jobId===j.id))return false;
     if(blockingHistory.some(r=>{try{return r.posting&&postingKey(r.posting)===postingKey(j.url)}catch{return false}}))return false;
     if(!jobIds&&seen[j.id]&&Date.now()-Date.parse(seen[j.id])<24*60*60000)return false;
     const fit=evaluate({...j,compensation:j.compensation||{min:search.minAnnualBaseUsd,currency:'USD',interval:'year'}},search);
     return (/director|vice president|\bvp\b|head|chief/i.test(j.title)||individualContributorReviewed(j,policy))&&!fit.reasons.some(r=>!['Annual USD base compensation needs verification','Location needs review'].includes(r));
    }).sort((a,b)=>{
     const rank=j=>evaluate({...j,compensation:j.compensation||{min:search.minAnnualBaseUsd,currency:'USD',interval:'year'}},search).score+(/\bremote\b/i.test(j.location)?5:0);
     return rank(b)-rank(a);
    }).slice(0,config.maxInspections);
    if(candidates.length){
     plan=await prepareApplications({home:this.home,adapter,jobIds:candidates.map(j=>j.id)});
     for(const j of candidates)seen[j.id]=new Date().toISOString();await this.store.write('worker-inspected.json',seen);
     const journal=await this.store.read('application-preflight-history.json',[]);journal.push({at:new Date().toISOString(),held:plan.held,prepared:plan.packets.map(p=>({id:p.id,company:p.job.company,title:p.job.title}))});await this.store.write('application-preflight-history.json',journal);
     if(submit&&config.autoSubmitApproved&&!this.paused){for(const packet of plan.packets){if(!await this.canContinue())break;if(standingAuthorizationMatches(await this.store.read('application-policy.json',{}),packet,adapter))await runApplications({home:this.home,adapter,packetIds:[packet.id],shouldContinue:()=>this.canContinue()});}}
    }
   }
   ledger=await this.store.read('application-ledger.json',[]);this.status.authorizationMode=policy.authorizationMode||'per-posting-packet';
   if(await this.stopAtTarget())return this.status;
   this.status.plan={prepared:plan.packets.filter(p=>!ledger.some(a=>a.packetDigest===p.digest)&&Date.parse(p.expiresAt)>Date.now()).length,held:plan.held};
   this.status.lastRun=new Date().toISOString();this.status.state=this.paused?'paused':'idle';this.status.stage='finished';return this.status;
  }catch(e){this.status.state='error';this.status.error=String(e.message).slice(0,300);throw e;}
  finally{this.running=false;await this.persist();await unlink(lock);}
 }
 async resume(attemptId){
  if(this.running)throw Error('Worker already running');
  const lock=path.join(this.home,'worker-run.lock');let handle;try{handle=await open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another worker owns this workspace');throw e;}
  this.running=true;this.paused=false;this.status.state='running';this.status.stage='continuing reviewed draft';this.status.error=null;await this.persist();
  try{await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await handle.close();if((await this.store.read('application-policy.json',{})).submissionMode!=='automatic'){this.status.state='paused';this.status.stage='manual final submission';return [{status:'review_only'}];}if(await this.stopAtTarget())return [];const adapter=await this.browser();const result=await runApplications({home:this.home,adapter,resumeAttemptId:attemptId,shouldContinue:()=>this.canContinue()});this.status.lastRun=new Date().toISOString();if(!await this.stopAtTarget()){this.status.state=this.paused?'paused':'idle';this.status.stage='finished';}return result;}catch(e){this.status.state='error';this.status.error=String(e.message).slice(0,300);throw e;}finally{this.running=false;await this.persist();await unlink(lock);}
 }
 async review(attemptId){
  if(this.running)throw Error('Wait for the current worker operation');
  const attempt=(await this.store.read('application-ledger.json',[])).find(a=>a.id===attemptId);
  if(!attempt||!['held','submission_unknown'].includes(attempt.status))throw Error('Choose a held or uncertain attempt');
  const adapter=await this.browser(),page=adapter.preservedPage?.(attempt);
  if(!page)throw Error('Preserved browser page unavailable; no new form was opened');
  await page.bringToFront();
  const directory=path.join(this.home,'receipts');await mkdir(directory,{recursive:true,mode:0o700});
  const screenshot=path.join(directory,attempt.id+'-held.png');
  const verificationInputs=page.locator('input[autocomplete="one-time-code"],input[maxlength="1"],input[id*="security" i],input[id*="otp" i],input[name*="verification" i],input[name*="token" i]');
  await page.screenshot({path:screenshot,fullPage:true,mask:[verificationInputs]});
  const review=await page.evaluate(()=>({visibility:document.visibilityState,focused:document.hasFocus(),visibleOptions:[...document.querySelectorAll('[role="option"]')].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()),fields:[...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]),select,textarea')].filter(e=>e.getClientRects().length).map(e=>({id:e.id,label:[...(e.labels||[])].map(l=>l.textContent.trim()).join(' '),required:e.required||e.getAttribute('aria-required')==='true',value:e.type==='file'?'':e.autocomplete==='one-time-code'||e.maxLength===1||/verification|security.?code|one.?time|\botp\b|password|api.?key|token/i.test(e.id+' '+e.name+' '+e.getAttribute('aria-label'))?'[verification value withheld]':e.value||e.closest('[class*="select__control"]')?.querySelector('[class*="single-value"], [class*="singleValue"]')?.textContent||''})),alerts:[...document.querySelectorAll('[role="alert"]')].filter(e=>e.getClientRects().length).map(e=>e.innerText.slice(0,300)),captchaFrames:[...document.querySelectorAll('iframe')].filter(e=>/captcha|challenge/i.test(e.title)).map(e=>({title:e.title,visibility:getComputedStyle(e).visibility,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},parentVisibility:getComputedStyle(e.parentElement).visibility,parentDisplay:getComputedStyle(e.parentElement).display}))}));
  await this.store.write('worker-held-review.json',{attemptId,screenshot,...review});return {attemptId,screenshot,...review};
 }
 async verifyEmail(data){
  if(this.running)throw Error('Wait for the current worker operation');
  if(!this.adapter)throw Error('Original verification browser unavailable; no new form was opened');
  const lock=path.join(this.home,'worker-run.lock'),handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,operation:'existing email verification',at:new Date().toISOString()}));await handle.close();
  this.running=true;this.status.state='verifying';this.status.stage='completing existing email verification';await this.persist();
  try{return await continueApplicationVerification({...data,home:this.home,adapter:this.adapter});}
  finally{this.running=false;this.status.state=this.paused?'paused':'idle';this.status.stage='verification check finished';await this.persist();await unlink(lock);}
 }
 async reconcileReceipts(){
  if(this.running)throw Error('Wait for the current worker operation');
  const lock=path.join(this.home,'worker-run.lock'),handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,operation:'read-only receipt recovery'}));await handle.close();this.running=true;
  try{const adapter=this.adapter||{recoverReceipt:async a=>({confirmed:false,posting:a.url})};const result=await reconcileApplications({home:this.home,adapter});this.status.reconciled=result;this.status.campaign=await campaignProgress({home:this.home});return result;}
  finally{this.running=false;await this.persist();await unlink(lock);}
 }
}
