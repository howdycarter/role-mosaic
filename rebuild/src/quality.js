import {readFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {boundedFile,htmlText} from './career.js';
export const qualityDigest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const jobDigest=job=>qualityDigest({url:job.url,title:job.title,location:job.location,description:job.description});
export const tracks=['product','design','engineering'];
export function roleTrack(title){
 if(/talent acquisition|people partners?|human resources|\b(?:legal|counsel|attorney|recruiting|recruiter|product marketing|sales engineering|gtm engineering)\b/i.test(title))return null;
 if(/\b(design|designer|ux|user experience)\b/i.test(title))return 'design';
 if(/\b(engineering|engineer|cto)\b/i.test(title))return 'engineering';
 if(/\bproduct\b/i.test(title))return 'product';return null;
}
const domains=[
 ['search-systems',/ranking|retrieval|query understanding|search and relevance/i],
 ['database-infrastructure',/query execution|storage engines?|database performance|distributed database|replication.*disaster recovery/i],
 ['speech-research',/speech (?:processing|synthesis|recognition)|\bstt\/tts\b|text.to.speech/i],
 ['usage-billing-marketplaces',/(?:consumption|usage).based billing|cloud marketplaces/i],
 ['clinical-credentials',/medical licen[cs]e|board.certified|\bmd degree\b/i],
 ['motion-design',/motion design|motion graphics|after effects/i],
];
/** Conservative checklist only: a reviewer still must assess every requirement. */
export function roleRequirements(job){
 const text=htmlText(htmlText(job.description||'')),requirements=[];let preferred=false;
 for(const raw of text.split(/\n+/)){const line=raw.trim();if(!line)continue;
  if(/^(?:bonus|nice.to.have|even better|preferred|perks|benefits|why (?:join|this)|about us)\b/i.test(line)){preferred=true;continue;}
  if(/^(?:requirements|what you (?:must bring|bring)|who you are|qualifications|technical experience|what we.re looking for|you bring)\b/i.test(line)){preferred=false;continue;}
  if(preferred||/not required|nice.to.have|preferred|a plus|bonus|no .* experience (?:is )?required/i.test(line))continue;
  if(!/experience|expertise|background|understanding|proficien|have built|must|years|degree|licen[cs]e|publications/i.test(line))continue;
  for(const[id,pattern]of domains)if(pattern.test(line)&&!requirements.some(r=>r.id===id))requirements.push({id,capability:id,text:line.slice(0,900)});
  const years=line.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:experience\s+(?:in|with|as)\s+)?(product management|B2B(?: desktop)? SaaS|engineering management|design)/i);
  if(years){const id='years-'+years[2].toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+years[1];if(!requirements.some(r=>r.id===id))requirements.push({id,capability:id,text:line.slice(0,900)});}
 }
 return requirements;
}
async function json(home,file,fallback){try{return JSON.parse(await boundedFile(path.join(home,file)))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
export async function loadEvidence(home){
 const data=await json(home,'career-evidence.json',{sources:[],facts:[],caseStudies:[]}),issues=[],texts=new Map();
 for(const source of data.sources||[]){try{const b=await boundedFile(path.resolve(home,source.path));if(qualityDigest(b)!==source.sha256)throw Error('source hash changed');texts.set(source.id,b.toString('utf8'));}catch{issues.push('Missing or changed source: '+source.id);}}
 const ids=new Set(),facts=[];
 for(const f of data.facts||[]){if(typeof f.id!=='string'||ids.has(f.id)||f.verified!==true||typeof f.quote!=='string'||!f.quote.trim()||f.text!==f.quote||!texts.get(f.sourceId)?.includes(f.quote)||!Array.isArray(f.tracks)||!f.tracks.every(t=>tracks.includes(t))||!Array.isArray(f.capabilities)){issues.push('Unverified, unsupported or duplicate fact: '+(f.id||'unknown'));continue;}ids.add(f.id);facts.push(f);}
 const caseStudies=(data.caseStudies||[]).filter(c=>{try{return c.id&&Array.isArray(c.tracks)&&c.tracks.every(t=>tracks.includes(t))&&c.evidenceIds?.length&&c.evidenceIds.every(id=>ids.has(id))&&new URL(c.url).protocol==='https:'&&!new URL(c.url).username&&!new URL(c.url).password}catch{return false}});
 return {facts,caseStudies,issues,digest:qualityDigest({data,validSources:[...texts.keys()],validFacts:facts.map(f=>f.id)}),configured:(data.sources||[]).length>0};
}
export async function selectTrackResume(home,track){
 const registry=await json(home,'resume-registry.json',{variants:{}}),v=registry.variants?.[track];
 if(!track||!v)return {status:'missing',track,reason:'No résumé registered for this track'};
 try{const file=path.resolve(home,v.path),b=await readFile(file);if(b.length>20*1024*1024||b.subarray(0,5).toString()!=='%PDF-'||qualityDigest(b)!==v.sha256)throw Error('PDF changed');
  const approval=v.approvalPath?await json(home,v.approvalPath,null):null,approved=approval?.approved===true&&approval.sha256===v.sha256&&path.resolve(home,approval.path)===file&&approval.track===track;
  return {track,status:approved?'approved':'draft',sha256:v.sha256,path:file,filename:path.basename(file),reason:approved?'Exact track PDF approved':'Draft requires exact-PDF approval'};
 }catch{return {track,status:'changed',reason:'Registered PDF or approval is missing or changed'}}
}
export function assessQuality(job,evidence,{resume,review,now=new Date()}={}){
 const track=roleTrack(job.title||''),facts=evidence.facts.filter(f=>f.tracks.includes(track)),requirements=roleRequirements(job),missingRequirements=requirements.filter(r=>!facts.some(f=>f.capabilities.includes(r.capability))),caseStudies=evidence.caseStudies.filter(c=>c.tracks.includes(track)&&c.evidenceIds.every(id=>facts.some(f=>f.id===id))),reasons=[];
 if(!track)reasons.push('Different profession or unsupported role track');
 if(!facts.length)reasons.push('No source-backed evidence for this track');
 if(missingRequirements.length)reasons.push('Mandatory specialization or tenure lacks evidence');
 if(!resume||resume.track!==track||resume.status!=='approved')reasons.push('Matching track résumé is missing, changed or unapproved');
 if(!caseStudies.length)reasons.push('No relevant case-study evidence');
 const ids=new Set(facts.map(f=>f.id)),currentReview=review?.jobDigest===jobDigest(job)&&review.evidenceDigest===evidence.digest&&review.resumeSha256===resume?.sha256&&review.allMandatoryReviewed===true&&typeof review.reviewer==='string'&&review.reviewer.trim()&&Date.parse(review.reviewedAt)<=now.getTime()&&now.getTime()-Date.parse(review.reviewedAt)<7*86400000&&review.requirements?.length&&review.requirements.every(r=>r.text?.trim()&&r.status==='supported'&&r.evidenceIds?.length&&r.evidenceIds.every(id=>ids.has(id)));
 if(!currentReview)reasons.push('Complete current role-requirement review needed');
 return {track,ready:reasons.length===0,reasons,requirements,missingRequirements,evidenceIds:facts.map(f=>f.id),caseStudies,resume:resume||{status:'missing',track},reviewCurrent:!!currentReview,reviewDigest:qualityDigest(review||null),jobDigest:jobDigest(job),evidenceDigest:evidence.digest};
}
export async function inspectQuality(home,job){const evidence=await loadEvidence(home),resume=await selectTrackResume(home,roleTrack(job.title||'')),reviews=await json(home,'quality-reviews.json',{});return {assessment:assessQuality(job,evidence,{resume,review:reviews[job.id]}),evidence};}
