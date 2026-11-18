import { createHash } from 'node:crypto';
import {roleTrack} from './quality.js';
import {nationwideUSRemote} from './location.js';
const terms = (s, items = []) => items.filter(x => new RegExp(`(?:^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(s));
export function canonical(raw) {
 const u = new URL(raw); u.hash='';
 for(const key of [...u.searchParams.keys()]) if (/^(utm_.+|source|ref|tracking)$/i.test(key)) u.searchParams.delete(key);
 u.searchParams.sort(); return u.href.replace(/\/$/,'');
}
export function identity(job) { return createHash('sha256').update(job.url ? canonical(job.url) : `${job.company}|${job.title}|${job.location}`).digest('hex').slice(0,20); }
export function compensation(job, config) {
 if (!Number.isFinite(config.minAnnualBaseUsd) || config.minAnnualBaseUsd < 0) return {pass:false,reason:'Configure your annual USD base salary floor'};
 const c=job.compensation;
 if (!c || c.currency!=='USD' || c.interval!=='year' || !Number.isFinite(c.min)) return {pass:false,reason:'Annual USD base compensation needs verification'};
 if(c.max!==undefined&&(!Number.isFinite(c.max)||c.max<c.min))return {pass:false,reason:'Published base compensation range is invalid'};
 if(config.salaryRangeMode!==undefined&&!['minimum','overlap'].includes(config.salaryRangeMode))return {pass:false,reason:'Configure a valid salary range mode'};
 if(config.salaryRangeMode==='overlap'){
  if(c.lowestTierMaximum!==undefined&&(!Number.isFinite(c.lowestTierMaximum)||c.lowestTierMaximum<c.min||c.lowestTierMaximum>c.max))return {pass:false,reason:'Published salary tiers need verification'};
  if(c.max>=config.minAnnualBaseUsd&&c.lowestTierMaximum<config.minAnnualBaseUsd)return {pass:false,reason:'Only some salary tiers can meet the applicant minimum; applicable tier needs verification'};
  const pass=c.min>=config.minAnnualBaseUsd||Number.isFinite(c.max)&&c.max>=config.minAnnualBaseUsd;
  return {pass,reason:pass?'Published base range can meet the applicant minimum':'Published base range cannot meet the applicant minimum'};
 }
 return {pass:c.min>=config.minAnnualBaseUsd,reason:c.min>=config.minAnnualBaseUsd?'Published base range meets floor':'Published base range starts below salary floor'};
}
export function evaluate(job, config) {
 const levelTitle=job.title.replace(/\b(?:sr|snr)\b\.?/gi,'Senior').replace(/\bjr\b\.?/gi,'Junior');
 const levelLabels=job.title+' | '+levelTitle;
 const track=roleTrack(job.title),fde=track==='fde'&&config.fdeTarget?.enabled===true,explicitJunior=/\b(?:junior|entry[ -]level|intern|internship|graduate|new[ -]grad|associate)\b/i.test(levelTitle);
 let levels=terms(levelLabels,config.titleLevels),fields=terms(job.title,config.titleFields);
 let unspecifiedFdeLevel=false;
 if(track==='fde'){
  fields=fde?['forward deployed engineering']:[];levels=fde&&!explicitJunior?terms(levelLabels,Array.isArray(config.fdeTarget.levels)?config.fdeTarget.levels:[]):[];
  if(fde&&!explicitJunior&&!levels.length&&config.fdeTarget.includeUnspecifiedLevel===true&&!/\b(?:senior|staff|principal|lead|founding|director|head|vp|vice president|manager|chief)\b/i.test(levelTitle)){levels=['FDE level unstated'];unspecifiedFdeLevel=true;}
 }
 const excludedPlaces=/\b(?:except|excluding|excluded|outside|ineligible|not eligible|not available)\b/i.test(job.location);
 const local=excludedPlaces?[]:terms(job.location,config.localCities);
 const remote=!excludedPlaces&&nationwideUSRemote(job.location);
 const reasons=[];
 if(job.listingState==='unlisted')reasons.push('Posting is no longer listed on the employer board');
 if(track==='fde'&&!fde)reasons.push('FDE target is not enabled');
 if(unspecifiedFdeLevel)reasons.push('FDE seniority is unstated; review required');
 if(!levels.length) reasons.push('Title does not match selected level');
 if(!fields.length) reasons.push('Title does not match selected field');
 if(!local.length&&!remote) reasons.push('Location needs review');
 if(/\b(intern|internship|unpaid)\b/i.test(job.title)) reasons.push('Excluded title');
 if(/\b(counsel|attorney|litigation|people partners?|product marketing|product sales|field sales|construction|product finance)\b/i.test(job.title)) reasons.push('Title belongs to a different profession or function');
 if(!roleTrack(job.title)&&!reasons.includes('Title belongs to a different profession or function'))reasons.push('Title belongs to a different profession or function');
 if((config.excludeEmployers||[]).some(x=>job.company.toLowerCase().includes(x.toLowerCase()))) reasons.push('Excluded employer');
 const pay=compensation(job,config); if(!pay.pass) reasons.push(pay.reason);
 const score=(levels.length?30:0)+(fields.length?30:0)+(local.length||remote?20:0)+(pay.pass?20:0);
 return {score,reasons,matches:{levels,fields,location:local.length?local:remote?['US remote']:[]},compensation:pay,disposition:reasons.length?'review':'match'};
}
export function mergeJobs(existing,incoming) {
 const map=new Map(existing.map(j=>[identity(j),j]));
 for(const job of incoming) {const id=identity(job),old=map.get(id);map.set(id,{...old,...job,id,firstSeen:old?.firstSeen??job.seenAt,status:old?.status??'new',note:old?.note??''});}
 return [...map.values()];
}
function roleKey(company, title) {
 const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
 const employer = normalize(company), role = normalize(title);
 return employer && role ? JSON.stringify([employer, role]) : null;
}
function historyUrl(url) {
 try { return url ? canonical(url) : null; } catch { return null; }
}

/** Build once per history snapshot when checking many jobs. Preserve the first matching row. */
export function createHistoryLookup(rows) {
 const byUrl = new Map(), byRole = new Map();
 rows.forEach((row, index) => {
  const url = historyUrl(row.posting), role = roleKey(row.company, row.role);
  if (url && !byUrl.has(url)) byUrl.set(url, index);
  if (role && !byRole.has(role)) byRole.set(role, index);
 });
 return job => {
  const urlIndex = byUrl.get(historyUrl(job.url)) ?? Infinity;
  const roleIndex = byRole.get(roleKey(job.company, job.title)) ?? Infinity;
  return rows[Math.min(urlIndex, roleIndex)] ?? null;
 };
}

export function historyMatch(job,rows) {
 const url = historyUrl(job.url), role = roleKey(job.company, job.title);
 return rows.find(row => (url && historyUrl(row.posting) === url) ||
   (role && roleKey(row.company, row.role) === role)) ?? null;
}
/** Only a locally verified, exact never-submitted hold can cease blocking. */
export function reapplicationHistory(job,rows,reviews=[]) {
 const scoped=reviews.filter(r=>{try{return canonical(r.posting)===canonical(job.url)}catch{return false}});
 if(!scoped.length)return rows;
 return rows.filter(row=>!(['held','skipped'].includes(row.status)&&scoped.some(r=>r.verifiedNeverSubmitted===true&&r.evidence?.trim()&&Number.isFinite(Date.parse(r.reviewedAt))&&r.historyRowSha256===createHash('sha256').update(JSON.stringify(row)).digest('hex'))));
}
