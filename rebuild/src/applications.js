import { readFile, mkdir, open, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { evaluate, canonical, historyMatch } from './core.js';
import { optionForAnswer, sameAnswer } from './application-values.js';
export { optionForAnswer, sameAnswer } from './application-values.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const dayAt = (date, timezone) => new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function postingKey(raw) {
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw Error('Posting must use HTTPS without credentials');
 const gh=u.searchParams.get('gh_jid')||(/(?:greenhouse\.io)$/.test(u.hostname)?u.pathname.match(/\/jobs\/(\d+)/)?.[1]:null);
 if(gh)return `greenhouse:${gh}`;
 if(['jobs.ashbyhq.com','jobs.lever.co'].includes(u.hostname)){const id=u.pathname.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];if(id)return `${u.hostname}:${id.toLowerCase()}`;}
 return canonical(raw);
}
export function supportedPosting(url) {
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['job-boards.greenhouse.io','boards.greenhouse.io','jobs.ashbyhq.com','jobs.lever.co'].includes(u.hostname);}catch{return false;}
}
export function samePosting(a,b){try{return new URL(a).origin===new URL(b).origin&&postingKey(a)===postingKey(b);}catch{return false;}}
export function salaryForLocation(text,state) {
 const clean=String(text).replace(/\s+/g,' '),ranges=[];
 const pattern=/((?:(?:USA|US|United States)\s+)?(?:annual\s+)?base\s+(?:salary|pay|compensation)(?:\s+range)?[^$]{0,180})\$([\d,]+)\s*(?:-|–|—|to)\s*\$([\d,]+)(?=(.{0,55}))/gi;
 for(const m of clean.matchAll(pattern)){
  const context=m[1]+' '+m[4];if(!/annual|per year|annually|yearly|full[- ]time position/i.test(context)||/CAD|AUD|hourly|monthly|per hour/i.test(context))continue;
  if(!/\bUS\b|USA|U\.S\.|USD|United States/i.test(context))continue;
  const region=m[1].match(/\(([^)]+)\)/)?.[1]||'';
  const min=Number(m[2].replaceAll(',','')),max=Number(m[3].replaceAll(',',''));
  if(min>max||min<1000)continue;
  ranges.push({min,max,currency:'USD',interval:'year',region,evidence:m[0].trim()});
 }
 const code=String(state||'').toUpperCase();
 const direct=ranges.filter(r=>r.region.split(/[,\s/]+/).includes(code));
 if(code && direct.length===1)return direct[0];
 const others=ranges.filter(r=>/all other.*states/i.test(r.region));
 if(code&&others.length===1&&ranges.some(r=>r.region&&!/all other/i.test(r.region))&&!ranges.some(r=>r.region.split(/[,\s/]+/).includes(code)))return others[0];
 const generic=ranges.filter(r=>!r.region);
 return ranges.length===1&&generic.length===1?generic[0]:null;
}
export function formDigest(form) {
 return digest({fields:form.fields.map(({label,type,required})=>({label,type,required})),resume:form.resume?.label,submit:form.submit?.label});
}
export function answerFor(field,profile) {
 const label=field.label.replace(/[*:]/g,'').replace(/\s+/g,' ').trim(),key=label.toLowerCase(),f=profile.facts;
 const exact=(profile.answers||[]).find(a=>a.question===label&&a.verified===true);
 if(exact)return exact.answer;
 if(/^(first name|given name)$/.test(key))return f.firstName;
 if(/^(last name|surname|family name)$/.test(key))return f.lastName;
 if(/^(name|full name|legal name)$/.test(key))return f.fullName;
 if(/^e-?mail(?: address)?$/.test(key))return f.email;
 if(/^(phone|phone number|telephone)$/.test(key))return f.phone;
 if(/^preferred name$/.test(key))return f.preferredName;
 if(/^country(?: code)?$/.test(key))return f.country;
 if(/^(city|current city|location \(city\))$/.test(key))return f.city;
 if(/^(state|state\/province|which u\.s\. state or canadian province do you reside in\?)$/.test(key))return f.state;
 if(/^postal code|^zip code$/.test(key))return f.postalCode;
 if(/^linkedin(?: profile| url)?$/.test(key))return f.linkedin;
 if(/^github(?: profile| url)?$/.test(key))return f.github;
 if(/^(website|portfolio|portfolio url|personal website)$/.test(key))return f.website;
 if(/^current company$/.test(key))return f.currentCompany;
 if(/sponsor/.test(key)&&/united states|u\.s\.|\bus\b/.test(key)&&typeof f.requiresSponsorshipUS==='boolean')return f.requiresSponsorshipUS?'Yes':'No';
 if(/(?:authorized|eligible|right) to work/.test(key)&&/united states|u\.s\.|\bus\b/.test(key)&&typeof f.authorizedUS==='boolean')return f.authorizedUS?'Yes':'No';
 return undefined;
}
export function fillPlan(form,profile) {
 const actions=[],missing=[];
 for(const field of form.fields){
  if(field.type==='file')continue;
  const value=answerFor(field,profile);
  if(value===undefined||value===null||value===''){if(field.required)missing.push(field.label);continue;}
  if(['password','hidden'].includes(field.type)||/password|signature|agree|consent|certif(?:y|ication)/i.test(field.label)){missing.push(`Manual action: ${field.label}`);continue;}
  if(field.value&&!sameAnswer(field,field.value,value)){missing.push(`Existing value differs: ${field.label}`);continue;}
  actions.push({field,value:String(value)});
 }
 if(!form.resume)missing.push('Supported resume upload');
 if(!form.submit)missing.push('Unambiguous final Submit application button');
 return {actions,missing};
}
export class ApplicationStore {
 constructor(root){this.root=path.resolve(root);}
 async read(name,fallback){try{return JSON.parse(await readFile(path.join(this.root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
 async write(name,value){await mkdir(this.root,{recursive:true,mode:0o700});const dest=path.join(this.root,name),temp=dest+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,dest);}
 async lock(work){await mkdir(this.root,{recursive:true,mode:0o700});const file=path.join(this.root,'application-run.lock');let handle;try{handle=await open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Another application run owns this workspace; inspect its lock before recovery');throw e;}try{await handle.writeFile(JSON.stringify({createdAt:new Date().toISOString()}));await handle.close();return await work();}finally{await unlink(file);}}
}
async function prerequisites(store,now) {
 const [policy,search,connections,profile,history]=await Promise.all([store.read('application-policy.json',null),store.read('search.json',null),store.read('connections.json',null),store.read('application-profile.json',null),store.read('history.json',null)]);
 if(!policy?.enabled||policy.maxPerDay<1||policy.maxPerDay>15||!Number.isInteger(policy.maxPerDay)||!Number.isFinite(policy.dailyBudgetUsd)||policy.dailyBudgetUsd<0||typeof policy.timezone!=='string')throw Error('Enable application policy with 1–15 daily attempts and a nonnegative daily budget');
 dayAt(now,policy.timezone); // Validate timezone before any operation.
 if(!search||!connections?.resume||!profile?.verified||!Array.isArray(history))throw Error('Search, local history, verified application profile and approved PDF are required');
 const approval=JSON.parse(await readFile(path.resolve(store.root,policy.resumeApprovalPath),'utf8'));
 const resumePath=path.resolve(store.root,connections.resume),pdf=await readFile(resumePath),resumeSha256=digest(pdf);
 if(pdf.subarray(0,5).toString()!=='%PDF-'||approval.approved!==true||approval.sha256!==resumeSha256||path.resolve(store.root,approval.path)!==resumePath)throw Error('Resume approval must match the exact attached PDF bytes and path');
 const profileSha256=digest(profile),searchSha256=digest(search);
 if(profileSha256!==policy.verifiedProfileSha256)throw Error('Application profile changed since verification');
 if(!profile.facts?.email||!profile.facts?.fullName)throw Error('Verified name and application email are required');
 return {policy,search,connections:{...connections,resume:resumePath},profile,history,resumeSha256,profileSha256,searchSha256};
}
function duplicate(job,history,attempts) {
 const key=postingKey(job.url);
 return !!historyMatch(job,history)||history.some(r=>{try{return r.posting&&postingKey(r.posting)===key;}catch{return false;}})||attempts.some(a=>a.postingKey===key&&a.status!=='preflight_hold');
}
function historyUsed(history,day,timezone,attempts){
 const ids=new Set(attempts.map(a=>a.id));
 return history.filter(r=>{
  if(ids.has(r.receiptId)||!/applied|submitted|confirmed_received|submission_unknown/i.test(r.status||r.outcome||''))return false;
  const date=r.submittedAt||r.appliedAt||r.date||r.at;if(!date)return false;
  if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date===day;
  const parsed=new Date(date);return Number.isFinite(parsed.getTime())&&dayAt(parsed,timezone)===day;
 }).length;
}
export function authorizationMatches(approval,packet,now) {
 return approval?.approved===true&&approval.packetDigest===packet.digest&&approval.resumeSha256===packet.resumeSha256&&approval.profileSha256===packet.profileSha256&&approval.searchSha256===packet.searchSha256&&Date.parse(approval.expiresAt)>now.getTime();
}
/** Inspect only: no contact fields, uploads or final buttons are touched. */
export async function prepareApplications({home,adapter,limit=15,jobIds,now=()=>new Date()}) {
 const store=new ApplicationStore(home),ctx=await prerequisites(store,now()),jobs=await store.read('jobs.json',[]),attempts=await store.read('application-ledger.json',[]);
 const packets=[],held=[];
 for(const job of jobs){
  if(jobIds&&!jobIds.includes(job.id))continue;
  if(packets.length>=Math.min(limit,ctx.policy.maxPerDay))break;
  if(!supportedPosting(job.url)||duplicate(job,ctx.history,attempts)||['applied','dismissed','rejected'].includes(job.status))continue;
  const preliminary=evaluate({...job,compensation:job.compensation||{min:ctx.search.minAnnualBaseUsd,currency:'USD',interval:'year'}},ctx.search);
  if(preliminary.reasons.some(r=>!['Annual USD base compensation needs verification','Location needs review'].includes(r)))continue;
  if(!/director|vice president|\bvp\b|head|chief/i.test(job.title)&&ctx.policy.requireICReview!==false){held.push({id:job.id,company:job.company,title:job.title,reason:'Individual-contributor specialization requires review'});continue;}
  let inspection;try{inspection=await adapter.inspect(job);}catch{held.push({id:job.id,company:job.company,title:job.title,url:job.url,reason:'Posting or form could not be inspected'});continue;}
  if(!inspection.titleVerified||inspection.closed||inspection.login){held.push({id:job.id,company:job.company,title:job.title,url:job.url,reason:'Closed, sign-in required, or title mismatch'});continue;}
  const pay=salaryForLocation(inspection.description,ctx.profile.facts.stateCode);
  const fit=evaluate({...job,location:inspection.location,compensation:pay},ctx.search);
  if(fit.disposition!=='match'){held.push({id:job.id,company:job.company,title:job.title,reason:fit.reasons.join('; ')});continue;}
  const plan=fillPlan(inspection.form,ctx.profile);
  if(plan.missing.length){held.push({id:job.id,company:job.company,title:job.title,url:job.url,reason:'Missing verified answers or supported controls',questions:plan.missing});continue;}
  const packet={id:randomUUID(),job,tabId:inspection.tabId,createdAt:now().toISOString(),expiresAt:new Date(now().getTime()+60*60*1000).toISOString(),resumeSha256:ctx.resumeSha256,profileSha256:ctx.profileSha256,searchSha256:ctx.searchSha256,formDigest:formDigest(inspection.form),salary:pay,location:inspection.location,fields:plan.actions.map(a=>a.field.label),answersPreview:plan.actions.map(a=>({question:a.field.label,answer:a.value})),resumeFilename:path.basename(ctx.connections.resume)};
  packet.digest=digest(packet);packets.push(packet);
 }
 const result={createdAt:now().toISOString(),packets,held};await store.write('application-plan.json',result);return result;
}
/** Executes only immutable, explicitly authorized packets. Exceptions after a submit click remain unknown forever until reconciled. */
export async function runApplications({home,adapter,now=()=>new Date(),limit=15,resumeAttemptId,packetIds,shouldContinue=()=>true}) {
 const store=new ApplicationStore(home);
 return store.lock(async()=>{
  const plan=await store.read('application-plan.json',null),approvals=await store.read('application-approvals.json',[]);
  if(!plan)throw Error('Prepare an application plan before running');
  const results=[];
  for(const packet of plan.packets.filter(p=>!packetIds||packetIds.includes(p.id)).slice(0,limit)){
   const at=now(),ctx=await prerequisites(store,at),attempts=await store.read('application-ledger.json',[]),key=postingKey(packet.job.url);
   if(packet.digest!==digest(Object.fromEntries(Object.entries(packet).filter(([k])=>k!=='digest')))||packet.resumeSha256!==ctx.resumeSha256||packet.profileSha256!==ctx.profileSha256||packet.searchSha256!==ctx.searchSha256||Date.parse(packet.expiresAt)<=at.getTime())throw Error('Application packet changed or expired; prepare and authorize again');
   const resumed=resumeAttemptId?attempts.find(a=>a.id===resumeAttemptId&&a.status==='held'&&a.packetDigest===packet.digest):null;
   if(resumeAttemptId&&!resumed)continue;
   if(duplicate(packet.job,ctx.history,attempts.filter(a=>a.id!==resumed?.id))){results.push({jobId:packet.job.id,status:'duplicate_held'});continue;}
   const day=dayAt(at,ctx.policy.timezone),today=attempts.filter(a=>a.day===day),imported=historyUsed(ctx.history,day,ctx.policy.timezone,attempts);
   if(today.length+imported-(resumed?.day===day?1:0)>=ctx.policy.maxPerDay){results.push({status:'daily_limit'});break;}
   const cost=adapter.estimatedCostUsd;
   if(!Number.isFinite(cost)||cost<0||today.reduce((n,a)=>n+(a.reservedCostUsd||0),0)+cost>ctx.policy.dailyBudgetUsd){results.push({status:'budget_limit'});break;}
   if(!approvals.some(a=>authorizationMatches(a,packet,at))){results.push({jobId:packet.job.id,status:'authorization_required'});continue;}
   if(resumed?.browserEvidence)adapter.restoreEvidence?.(packet.job.id,resumed.browserEvidence);
   const inspection=await adapter.inspect(packet.job,{tabId:packet.tabId});
   const fit=evaluate({...packet.job,location:inspection.location,compensation:salaryForLocation(inspection.description,ctx.profile.facts.stateCode)},ctx.search),actions=fillPlan(inspection.form,ctx.profile);
   if(!inspection.titleVerified||inspection.closed||inspection.login||fit.disposition!=='match'||formDigest(inspection.form)!==packet.formDigest||actions.missing.length){results.push({jobId:packet.job.id,status:'posting_or_form_changed'});continue;}
   const attempt=resumed||{id:randomUUID(),jobId:packet.job.id,company:packet.job.company,title:packet.job.title,url:packet.job.url,tabId:packet.tabId,postingKey:key,day,status:'preparing',createdAt:at.toISOString(),reservedCostUsd:cost,resumeSha256:ctx.resumeSha256,profileSha256:ctx.profileSha256,packetDigest:packet.digest};
   if(resumed){attempt.status='preparing';attempt.reason=null;attempt.day=day;}else attempts.push(attempt);const save=async()=>{attempt.updatedAt=now().toISOString();await store.write('application-ledger.json',attempts);};await save();
   try{
    attempt.browserEvidence=await adapter.fill(inspection,actions.actions,ctx.connections.resume);await save();
    const check=await adapter.verify(inspection,actions.actions,ctx.connections.resume);
    if(!check.ok||check.captcha||check.manual){attempt.status='held';attempt.reason=check.reason||'Readback, CAPTCHA or manual action required';await save();results.push({...attempt});continue;}
    if(!await shouldContinue()){attempt.status='held';attempt.reason='Worker paused before submission';await save();results.push({...attempt});continue;}
    const current=await prerequisites(store,now());
    if(current.resumeSha256!==packet.resumeSha256||current.profileSha256!==packet.profileSha256||current.searchSha256!==packet.searchSha256||!(await store.read('application-approvals.json',[])).some(a=>authorizationMatches(a,packet,now()))||duplicate(packet.job,current.history,attempts.filter(a=>a.id!==attempt.id)))throw Error('Submission authorization or applicant state changed');
    attempt.status='submission_unknown';await save(); // Durable BEFORE the only final click.
    await adapter.submit(inspection);
    const receipt=await adapter.confirm(inspection);
    if(receipt?.confirmed===true&&receipt.text&&samePosting(receipt.posting,packet.job.url)){
     attempt.status='submitted';attempt.reason=null;attempt.receipt={...receipt,verifiedAt:now().toISOString(),resumeSha256:ctx.resumeSha256};await save();
     const history=await store.read('history.json',[]);history.push({company:packet.job.company,role:packet.job.title,posting:packet.job.url,status:'submitted',submittedAt:now().toISOString(),receiptId:attempt.id});await store.write('history.json',history);
     const jobs=await store.read('jobs.json',[]),job=jobs.find(j=>j.id===packet.job.id);if(job){job.status='applied';job.receiptId=attempt.id;await store.write('jobs.json',jobs);}
    }else{attempt.reason='No employer confirmation observed; reconciliation required';await save();}
   }catch{if(!['submission_unknown','submitted'].includes(attempt.status))attempt.status='held';attempt.reason=attempt.status==='submitted'?'Employer receipt saved; local tracker repair required':'Application interrupted at '+(adapter.lastControl||'browser operation')+'; inspect the preserved browser tab before any retry';await save();}
   results.push({...attempt});
  }
  await store.write('application-run-result.json',{at:now().toISOString(),results});return results;
 });
}

/** Invoke only from an explicit local UI/assistant authorization identifying the posting and applicant data. */
export async function approvePackets({home,ids,now=()=>new Date()}) {
 if(!Array.isArray(ids)||ids.length<1||ids.length>15||ids.some(id=>typeof id!=='string'))throw Error('Choose 1–15 prepared application packets');
 const store=new ApplicationStore(home),ctx=await prerequisites(store,now()),plan=await store.read('application-plan.json',null);
 const packets=ids.map(id=>plan?.packets.find(p=>p.id===id));
 if(packets.some(p=>!p||Date.parse(p.expiresAt)<=now().getTime()||p.resumeSha256!==ctx.resumeSha256||p.profileSha256!==ctx.profileSha256||p.searchSha256!==ctx.searchSha256))throw Error('Prepared packet expired or applicant configuration changed');
 const old=await store.read('application-approvals.json',[]),approvals=packets.map(p=>({approved:true,packetDigest:p.digest,resumeSha256:p.resumeSha256,profileSha256:p.profileSha256,searchSha256:p.searchSha256,expiresAt:p.expiresAt,approvedAt:now().toISOString()}));
 await store.write('application-approvals.json',[...old.filter(a=>!approvals.some(b=>a.packetDigest===b.packetDigest)),...approvals]);return {approved:approvals.length};
}
/** Receipt-only recovery: this never fills, clicks, or retries a submission. */
export async function reconcileApplications({home,adapter,now=()=>new Date()}) {
 const store=new ApplicationStore(home);
 return store.lock(async()=>{
  const ledger=await store.read('application-ledger.json',[]),results=[];
  for(const attempt of ledger.filter(a=>a.status==='submission_unknown'||a.status==='submitted'&&a.receipt?.confirmed)){
   try{
    const job={id:attempt.jobId,title:attempt.title,company:attempt.company,url:attempt.url};
    const inspection=attempt.status==='submitted'?null:await adapter.inspect(job,{tabId:attempt.tabId});
    const receipt=attempt.status==='submitted'?attempt.receipt:await adapter.confirm(inspection);
    if(!receipt?.confirmed||!receipt.text||!samePosting(receipt.posting,attempt.url)){results.push({jobId:attempt.jobId,status:'submission_unknown'});continue;}
    attempt.status='submitted';attempt.reason=null;attempt.receipt={...receipt,verifiedAt:now().toISOString(),resumeSha256:attempt.resumeSha256};attempt.updatedAt=now().toISOString();await store.write('application-ledger.json',ledger);
    const history=await store.read('history.json',[]);if(!history.some(r=>r.receiptId===attempt.id)){history.push({company:attempt.company,role:attempt.title,posting:attempt.url,status:'submitted',submittedAt:now().toISOString(),receiptId:attempt.id});await store.write('history.json',history);}
    const jobs=await store.read('jobs.json',[]),jobRecord=jobs.find(j=>j.id===attempt.jobId);if(jobRecord){jobRecord.status='applied';jobRecord.receiptId=attempt.id;await store.write('jobs.json',jobs);}
    results.push({jobId:attempt.jobId,status:'submitted'});
   }catch{results.push({jobId:attempt.jobId,status:attempt.status==='submitted'?'submitted_tracker_repair_needed':'submission_unknown'});}
  }
  return results;
 });
}

export async function approveResume({home,confirm,now=()=>new Date()}) {
 if(confirm!=='reviewed')throw Error('Review the exact external PDF, then pass --confirm reviewed');
 const store=new ApplicationStore(home),connections=await store.read('connections.json',null);
 if(!connections?.resume)throw Error('Attach your external PDF first');
 const file=path.resolve(store.root,connections.resume),pdf=await readFile(file);
 if(pdf.subarray(0,5).toString()!=='%PDF-')throw Error('Attached document is not a PDF');
 const sha256=digest(pdf),existing=await store.read('resume-approval.json',null);
 if(existing&&existing.sha256!==sha256)throw Error('Preserve the previous approval; use a separate workspace for a replacement');
 await store.write('resume-approval.json',{approved:true,path:file,sha256,recordedAt:now().toISOString(),evidence:'Applicant explicitly invoked approve-resume --confirm reviewed'});
 return {sha256};
}
export async function configureApplications({home,profileFile,maxPerDay=15,dailyBudgetUsd=1,timezone='America/Chicago',confirm}) {
 if(confirm!=='reviewed')throw Error('Review your application facts and pass --confirm reviewed');
 if(!Number.isInteger(maxPerDay)||maxPerDay<1||maxPerDay>15||!Number.isFinite(dailyBudgetUsd)||dailyBudgetUsd<0)throw Error('Choose 1–15 daily attempts and a nonnegative budget');
 dayAt(new Date(),timezone);
 const store=new ApplicationStore(home);
 if(await store.read('application-profile.json',null)||await store.read('application-policy.json',null))throw Error('Application configuration already exists; preserve it and edit it deliberately');
 const profile=JSON.parse(await readFile(path.resolve(profileFile),'utf8'));
 if(profile.verified!==true||typeof profile.facts?.fullName!=='string'||!profile.facts.fullName.trim()||typeof profile.facts?.email!=='string'||!profile.facts.email.includes('@'))throw Error('Supply your own verified application facts with a name and email');
 const approval=await store.read('resume-approval.json',null),connections=await store.read('connections.json',null);
 if(!connections?.resume||!approval?.approved||approval.sha256!==digest(await readFile(path.resolve(store.root,connections.resume))))throw Error('Approve the exact attached PDF first');
 await store.write('application-profile.json',profile);
 await store.write('application-policy.json',{version:1,enabled:true,maxPerDay,dailyBudgetUsd,timezone,requireICReview:true,resumeApprovalPath:'resume-approval.json',verifiedProfileSha256:digest(profile),authorizationMode:'per-posting-packet'});
 return {maxPerDay,dailyBudgetUsd,timezone};
}
