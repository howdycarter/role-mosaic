import {readFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {boundedFile,htmlText} from './career.js';
export const qualityDigest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const jobDigest=job=>qualityDigest({url:job.url,title:job.title,location:job.location,description:job.description});
export const tracks=['product','design','engineering','fde'];
export function roleTrack(title){
 if(/talent acquisition|people partners?|human resources|\b(?:legal|counsel|attorney|recruiting|recruiter|product marketing|sales engineering|sales engineer|gtm engineering)\b/i.test(title))return null;
 const deployed=/\bforward[\s-]+deployed\b/i.test(title),acronym=/\bfde\b/i.test(title),nonEngineering=/\b(?:marketing|account executive|business development|sales development|product manager|product management|designer|design)\b/i.test(title);
 if((deployed||acronym)&&/\b(?:program|project) (?:managers?|management|directors?)\b/i.test(title))return null;
 if(!nonEngineering&&(deployed&&/\b(?:engineer|engineers|engineering)\b/i.test(title)||acronym))return 'fde';
 if(/\b(design|designer|ux|user experience)\b/i.test(title))return 'design';
 if(/\b(engineering|engineer|cto)\b/i.test(title))return 'engineering';
 if(/\bproduct\b/i.test(title))return 'product';return null;
}
const domains=[
 ['database-infrastructure',/query execution|storage engines?|database performance|distributed database|replication.*disaster recovery/i],
 ['speech-research',/speech (?:processing|synthesis|recognition)|\bstt\/tts\b|text.to.speech/i],
 ['usage-billing-marketplaces',/(?:consumption|usage).based billing|cloud marketplaces/i],
 ['clinical-credentials',/medical licen[cs]e|board.certified|\bmd degree\b/i],
 ['motion-design',/motion design|motion graphics|after effects/i],
];
// Classify the required skill in its own clause. Retrieval for a language model
// and search ranking infrastructure have different evidence requirements.
const modelContext=/\b(?:llms?|large language models?|language models?|ai agents?|ai workflows?|generative AI|agentic|retrieval[- ]augmented generation|RAG)\b/i;
const retrieval=/\b(?:retrieval|retrieval[- ]augmented generation|RAG)\b/i;
const explicitSearch=/\b(?:ranking|query understanding|search (?:and relevance|relevance|ranking|infrastructure|engines?|systems?)|information retrieval systems?)\b/i;
const production=/\bproduction\b/i;
const deployment=/\bdeploy(?:ing|ed|ment)?\b/i;
const modelSkills=[
 {capability:'ai-agent-delivery',component:'building and deploying AI agents',pattern:/\b(?:build(?:ing)?|built|develop(?:ing|ed)?)\b[^.;]{0,50}\bdeploy(?:ing|ed)?\b[^.;]{0,45}\bagents?\b/i,related:['production-agent-design','production-workflow-automation']},
 {capability:'agent-tool-use',component:'agent tool use',pattern:/\b(?:tool (?:use|calls?|calling)|function calling)\b/i,aliases:['mcp-tool-integration']},
 {capability:'ai-orchestration-implementation',component:'agent orchestration',pattern:/\borchestrat(?:ion|ing)\b/i},
 {capability:'agent-state-management',component:'agent state management',pattern:/\b(?:state management|stateful agents?|persistent state|agent state)\b|\bstate\s*[,;](?=\s*(?:and\b|\w))/i},
 {capability:'failure-handling',component:'failure handling',pattern:/\b(?:failure handling|failure recovery|fault tolerance)\b/i},
 {capability:'llm-retrieval-experience',component:'retrieval for language models',pattern:retrieval},
 {capability:'llm-structured-outputs',component:'structured model outputs',pattern:/\bstructured (?:model |LLM )?outputs?\b/i,related:['structured-tool-outputs']},
 {capability:'ai-evaluation',component:'model evaluations',pattern:/\b(?:evals?|evaluations?)\b/i,aliases:['evaluation-tooling']},
 {capability:'llm-monitoring',component:'model monitoring',pattern:/\b(?:monitoring|observability)\b/i},
 {capability:'llm-controls',component:'model controls',pattern:/\b(?:controls|guardrails)\b/i,related:['human-in-the-loop','privacy-by-design']},
];
function scopedSkill(skill,line,scope){
 const tags=[skill.capability,...(skill.aliases||[])];
 const prefixes=scope==='production'?['production-']:scope==='deployed'?['deployed-','production-']:['','deployed-','production-'];
 return {
  id:(scope?scope+'-':'')+skill.capability,capability:skill.capability,component:skill.component,text:line,
  ...(scope?{scope}:{}),evidenceCapabilities:prefixes.flatMap(prefix=>tags.map(tag=>prefix+tag)),
  relatedCapabilities:[...tags,...(skill.related||[])],
 };
}
// A checklist supports a review of the full role. An unclassified qualification
// still belongs in that review.
export function roleRequirements(job){
 const text=htmlText(htmlText(job.description||'')),requirements=[];let preferred=false;
 const add=requirement=>{if(!requirements.some(r=>r.id===requirement.id && r.text===requirement.text))requirements.push(requirement);};
 for(const raw of text.split(/\n+/)){const line=raw.trim();if(!line)continue;
  if(/^(?:bonus|nice.to.have|even better|p\s*referred|perks|benefits|why (?:join|this)|about us)\b/i.test(line)){preferred=true;continue;}
  if(/^(?:required qualifications|requirements|what you (?:must bring|bring)|who you are|qualifications|technical experience|what we.re looking for|you bring)\b/i.test(line)){preferred=false;continue;}
  if(preferred||/not required|nice.to.have|preferred|a plus|bonus|no .* experience (?:is )?required/i.test(line))continue;
  if(!/experience|expertise|background|understanding|proficien|have built|must|years|degree|licen[cs]e|publications/i.test(line))continue;
  for(const clause of line.split(/;|[.!?]\s+(?=[A-Z])/)){
   const model=modelContext.test(clause);
   if(explicitSearch.test(clause)||(!model&&retrieval.test(clause)&&/\bsearch\b/i.test(job.title)))
    add({id:'search-systems',capability:'search-systems',text:line});
   if(!model)continue;
   const scope=production.test(clause)?'production':deployment.test(clause)?'deployed':undefined;
   for(const skill of modelSkills)if(skill.pattern.test(clause))add(scopedSkill(skill,line,scope));
  }
  for(const[id,pattern]of domains)if(pattern.test(line))add({id,capability:id,text:line});
  const years=line.match(/\b(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:experience\s+(?:in|with|as)\s+)?(product management|B2B(?: desktop)? SaaS|engineering management|design)/i);
  if(years){const id='years-'+years[2].toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+years[1];add({id,capability:id,text:line});}
 }
 return requirements;
}

// A verified general capability can carry a stronger scope when its source quote
// explicitly puts the feature in a personally shipped system. Adjacent claims,
// proposed work and prototype/code-only observations cannot provide that link.
const qualifiedOrHypothetical=/\b(?:not|never|no|only|prototype|prototyped|prototyping|sandbox|synthetic|staging|locally|unrelated|separate|simulated|planned|planning|may|might|could|would|but|except|without|unverified|unconfirmed|cannot|unable)\b|n['’]t\b/i;
const firsthandDelivery=/\b(?:I|we)\s+(?:(?:have|personally|directly)\s+)*(?:deployed|shipped|built|operated|maintained|implemented|ran|integrated|monitored|evaluated)\b/i;
const inProduction=/\b(?:in|to|into)\s+(?:live\s+)?production\b|\bin a production (?:service|system|environment|application|deployment)\b/i;
function directlySupportsScope(requirement,fact){
 if(!requirement.scope||typeof fact.quote!=='string'||fact.text!==fact.quote||qualifiedOrHypothetical.test(fact.quote))return false;
 const skill=modelSkills.find(s=>s.capability===requirement.capability);
 if(!skill||![skill.capability,...(skill.aliases||[])].some(tag=>fact.capabilities.includes(tag)))return false;
 return fact.quote.split(/[.;!?\n]|\b(?:then|while|whereas)\b|\band\s+(?=(?:I|we|deployed|shipped|built|operated|maintained|implemented|ran|integrated|monitored|evaluated)\b)/i).some(clause=>{
  const claim=clause.match(firsthandDelivery);
  if(!claim)return false;
  const action=clause.slice(claim.index);
  if(!skill.pattern.test(action))return false;
  return inProduction.test(action)||(requirement.scope==='deployed'&&/\b(?:deployed|shipped)\b/i.test(action));
 });
}
function bindRequirement(requirement,facts){
 const {relatedCapabilities=[],...result}=requirement;
 const evidenceCapabilities=result.evidenceCapabilities||[result.capability];
 const ids=[],related=[];
 for(const fact of facts){
  if(evidenceCapabilities.some(cap=>fact.capabilities.includes(cap))||directlySupportsScope(requirement,fact))ids.push(fact.id);
  else if(relatedCapabilities.some(cap=>fact.capabilities.includes(cap)))related.push(fact.id);
 }
 return {...result,component:result.component||result.capability,evidenceCapabilities,
  suggestedCapability:evidenceCapabilities[0],evidenceIds:ids,relatedEvidenceIds:related};
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
 const track=roleTrack(job.title||''),facts=evidence.facts.filter(f=>f.tracks.includes(track)),requirements=roleRequirements(job).map(r=>bindRequirement(r,facts)),missingRequirements=requirements.filter(r=>!r.evidenceIds.length),caseStudies=evidence.caseStudies.filter(c=>c.tracks.includes(track)&&c.evidenceIds.every(id=>facts.some(f=>f.id===id))),reasons=[];
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
