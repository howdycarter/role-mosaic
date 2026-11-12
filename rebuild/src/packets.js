import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';import path from 'node:path';
import {ApplicationStore} from './applications.js';import {evaluate,historyMatch} from './core.js';
import {loadEvidence,roleTrack,selectTrackResume,assessQuality,qualityDigest,jobDigest,tracks} from './quality.js';
import {boundedFile} from './career.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function registerTrackResume({home,track,file,confirm}){
 if(!tracks.includes(track)||!file||confirm!==undefined&&confirm!=='reviewed')throw Error('Choose product, design, engineering or fde and a PDF; use --confirm reviewed only after review');
 const source=path.resolve(file),bytes=await readFile(source);if(bytes.length>20*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('A PDF of at most 20 MiB is required');
 const sha256=qualityDigest(bytes),store=new ApplicationStore(home),relative=path.join('resume-variants',track+'-'+sha256.slice(0,16)+'.pdf'),destination=path.join(home,relative);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
 if(source!==destination){try{await copyFile(source,destination,1)}catch(e){if(e.code!=='EEXIST'||qualityDigest(await readFile(destination))!==sha256)throw e;}}
 const {chmod}=await import('node:fs/promises');await chmod(destination,0o600);
 const registry=await store.read('resume-registry.json',{version:1,variants:{},history:[]}),old=registry.variants[track];if(old)(registry.history||=[]).push({track,...old,replacedAt:new Date().toISOString()});
 const entry={path:relative,sha256,registeredAt:new Date().toISOString()};
 if(confirm==='reviewed'){entry.approvalPath=path.join('resume-variants',track+'-'+sha256.slice(0,16)+'-approval.json');await store.write(entry.approvalPath,{approved:true,track,path:relative,sha256,recordedAt:new Date().toISOString(),evidence:'Applicant explicitly registered this exact track PDF with --confirm reviewed. Attachment or preparation alone is not approval.'});}
 registry.variants[track]=entry;await store.write('resume-registry.json',registry);return selectTrackResume(home,track);
}
export async function initializeQuality(home){const store=new ApplicationStore(home);if(!await store.read('career-evidence.json',null))await store.write('career-evidence.json',{version:1,sources:[],facts:[],caseStudies:[]});if(!await store.read('quality-reviews.json',null))await store.write('quality-reviews.json',{});if(!await store.read('resume-registry.json',null))await store.write('resume-registry.json',{version:1,variants:{},history:[]});return {submissionMode:'manual',message:'Add verified source quotes, track PDFs and role reviews before an application is ready.'};}
export async function recordRoleReview({home,jobId,file,confirm,reviewer}){
 if(confirm!=='reviewed'||typeof reviewer!=='string'||!reviewer.trim()||!file)throw Error('Review every requirement and identify the actual reviewer');
 const store=new ApplicationStore(home),job=(await store.read('jobs.json',[])).find(j=>j.id===jobId);if(!job)throw Error('Unknown job');const data=JSON.parse(await boundedFile(file));
 if(!Array.isArray(data.requirements)||!data.requirements.length||data.requirements.some(r=>typeof r.text!=='string'||!r.text.trim()||!['supported','unknown','contradicted'].includes(r.status)||!Array.isArray(r.evidenceIds)||r.evidenceIds.some(id=>typeof id!=='string')))throw Error('List each requirement, status and evidence IDs; leave unsupported requirements unknown');
 const evidence=await loadEvidence(home),resume=await selectTrackResume(home,roleTrack(job.title)),review={jobDigest:jobDigest(job),evidenceDigest:evidence.digest,resumeSha256:resume.sha256||null,allMandatoryReviewed:true,reviewer:reviewer.trim(),reviewedAt:new Date().toISOString(),requirements:data.requirements};
 const reviews=await store.read('quality-reviews.json',{});reviews[job.id]=review;await store.write('quality-reviews.json',reviews);return assessQuality(job,evidence,{resume,review});
}
export function packetHtml(packet){
 const q=packet.quality,list=items=>items.map(s=>'<li>'+esc(s)+'</li>').join(''),links=packet.caseStudies.map(c=>'<li><a rel="noreferrer noopener" href="'+esc(c.url)+'">'+esc(c.title||c.id)+'</a></li>').join('');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Application packet</title><style>body{font:16px/1.6 system-ui;max-width:850px;margin:40px auto;padding:0 24px;color:#193a32}section{border-top:1px solid #ccd6d1;margin-top:24px}pre{white-space:pre-wrap}a{color:#185c4b}@media print{body{margin:0}}</style><h1>${esc(packet.job.title)}</h1><p>${esc(packet.job.company)} · ${esc(packet.job.location)}</p><p><strong>${packet.stale?'Stale — regenerate this packet':q.ready?'Evidence reviewed; manual final submission':'Draft — requirements or approvals unresolved'}</strong></p><p>Prepared locally. Nothing has been filled, uploaded or submitted. Employer decisions and interview outcomes cannot be guaranteed.</p><section><h2>Résumé</h2><p>${esc(q.track||'Unclassified')} · ${esc(q.resume.status)} · ${esc(q.resume.filename||'No matching track PDF')}</p><p>Use the exact reviewed track PDF. Do not substitute another résumé.</p></section><section><h2>Requirements and gaps</h2><ul>${list(q.reasons)}</ul><ul>${list(q.requirements.map(r=>r.text+(q.missingRequirements.some(m=>m.id===r.id)?' — evidence missing':' — evidence available; confirm applicability')))}</ul><p>A reviewer must assess all employer requirements; this checklist is conservative, not exhaustive.</p></section><section><h2>Source-backed proof points</h2><ul>${list(packet.proofPoints.map(f=>f.text+' [source: '+f.sourceId+'; fact: '+f.id+']'))}</ul></section><section><h2>Relevant case studies</h2><ul>${links||'<li>No verified case study is connected.</li>'}</ul></section><section><h2>Submission risk</h2><p>Manual final submission is the default. Automated browsers can expose automation signals. No claim is made that an employer used those signals or that manual submission prevents rejection.</p><p>Resolve every missing fact and approval. Verify work history, titles, dates, compensation, eligibility and attachments. Existing uncertain applications must be reconciled, not restarted.</p></section><section><h2>Employer posting</h2><p>${/^https:\/\//.test(packet.job.url)?'<a rel="noreferrer noopener" href="'+esc(packet.job.url)+'">Open employer posting</a>':'Posting URL needs review'}</p></section></html>`;
}
/** Purely local preparation; no browser, provider call, form fill or application attempt. */
export async function prepareQualityPackets({home,jobIds,limit=15}){
 if(!Number.isInteger(limit)||limit<1||limit>30||jobIds&&(!Array.isArray(jobIds)||jobIds.length>30||jobIds.some(id=>typeof id!=='string')))throw Error('Choose at most 30 roles');
 const store=new ApplicationStore(home),[jobs,config,history,ledger,evidence,reviews]=await Promise.all([store.read('jobs.json',[]),store.read('search.json',{}),store.read('history.json',[]),store.read('application-ledger.json',[]),loadEvidence(home),store.read('quality-reviews.json',{})]);
 const resumes=new Map();for(const t of tracks)resumes.set(t,await selectTrackResume(home,t));
 const selected=jobs.filter(j=>(!jobIds||jobIds.includes(j.id))&&roleTrack(j.title)&&!['applied','dismissed','rejected'].includes(j.status)&&!historyMatch(j,history)&&!ledger.some(a=>a.jobId===j.id||a.url===j.url)).map(job=>{
  const fit=evaluate(job,config),quality=assessQuality(job,evidence,{resume:resumes.get(roleTrack(job.title)),review:reviews[job.id]});
  if(fit.reasons.length){quality.ready=false;quality.reasons.push(...fit.reasons);}
  return {job,fit,quality};
 }).filter(x=>jobIds||x.fit.matches.levels.length&&x.fit.matches.fields.length&&x.fit.matches.location.length).sort((a,b)=>Number(b.quality.ready)-Number(a.quality.ready)||a.fit.reasons.length-b.fit.reasons.length||a.quality.missingRequirements.length-b.quality.missingRequirements.length||Number(!a.quality.caseStudies.length)-Number(!b.quality.caseStudies.length)||Number(!a.quality.evidenceIds.length)-Number(!b.quality.evidenceIds.length)||Number(!/director|head|vice president|\bvp\b/i.test(a.job.title))-Number(!/director|head|vice president|\bvp\b/i.test(b.job.title))||b.fit.score-a.fit.score);
 const packets=[],companies=new Map();await mkdir(path.join(home,'packets'),{recursive:true,mode:0o700});
 for(const{job,quality}of selected){
  // Diversify the discovery shortlist; explicit selections remain exact.
  const company=String(job.company||'').toLowerCase();if(!jobIds&&(companies.get(company)||0)>=2)continue;companies.set(company,(companies.get(company)||0)+1);
  const packet={version:1,job:{id:job.id,company:job.company,title:job.title,location:job.location,url:job.url},submissionMode:'manual',searchDigest:qualityDigest(config),quality,proofPoints:evidence.facts.filter(f=>quality.evidenceIds.includes(f.id)),caseStudies:quality.caseStudies,evidenceIssues:evidence.issues};packet.id=qualityDigest(packet);packet.preparedAt=new Date().toISOString();
  await store.write(path.join('packets',packet.id+'.json'),packet);await writeFile(path.join(home,'packets',packet.id+'.html'),packetHtml(packet),{mode:0o600});packets.push(packet);if(packets.length>=limit)break;
 }
 const result={preparedAt:new Date().toISOString(),submissionMode:'manual',packets,evidenceIssues:evidence.issues};await store.write('quality-packets.json',result);return result;
}

/** Revalidate cached packets on every read; cached readiness is never authoritative. */
export async function refreshPacket(home,packet,cached={}){
 const store=new ApplicationStore(home),[jobs,config,history,ledger,evidence,reviews]=await Promise.all([cached.jobs??store.read('jobs.json',[]),cached.config??store.read('search.json',{}),cached.history??store.read('history.json',[]),cached.ledger??store.read('application-ledger.json',[]),cached.evidence??loadEvidence(home),cached.reviews??store.read('quality-reviews.json',{})]);
 const job=jobs.find(j=>j.id===packet.job.id),fallback={...packet.job,description:''},current=job||fallback,resume=await selectTrackResume(home,roleTrack(current.title)),quality=assessQuality(current,evidence,{resume,review:reviews[current.id]});
 const fit=job?evaluate(job,config):{reasons:['Posting no longer exists in the current job inventory']};if(fit.reasons.length){quality.ready=false;quality.reasons.push(...fit.reasons);}
 const {id,preparedAt,...payload}=packet,changed=qualityDigest(payload)!==id||qualityDigest(quality)!==qualityDigest(packet.quality)||packet.searchDigest!==qualityDigest(config);
 const attempted=job&&(['applied','dismissed','rejected'].includes(job.status)||historyMatch(job,history)||ledger.some(a=>a.jobId===job.id||a.url===job.url));
 const stale=!job||changed||!!attempted;if(stale){quality.ready=false;quality.reasons.push('Regenerate this packet: its evidence, posting, résumé, review, search rules or application status changed');}
 return {...packet,job:job?{id:job.id,company:job.company,title:job.title,location:job.location,url:job.url}:packet.job,stale,quality,proofPoints:evidence.facts.filter(f=>quality.evidenceIds.includes(f.id)),caseStudies:quality.caseStudies,evidenceIssues:evidence.issues};
}
