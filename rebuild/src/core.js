import { createHash } from 'node:crypto';
const terms = (s, items = []) => items.filter(x => new RegExp(`(?:^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(s));
export function canonical(raw) {
 const u = new URL(raw); u.hash='';
 for(const key of [...u.searchParams.keys()]) if (/^(utm_.+|source|ref|tracking)$/i.test(key)) u.searchParams.delete(key);
 u.searchParams.sort(); return u.href.replace(/\/$/,'');
}
export function identity(job) { return createHash('sha256').update(job.url ? canonical(job.url) : `${job.company}|${job.title}|${job.location}`).digest('hex').slice(0,20); }
export function compensation(job, config) {
 const c=job.compensation;
 if (!c || c.currency!=='USD' || c.interval!=='year' || !Number.isFinite(c.min)) return {pass:false,reason:'Annual USD base compensation needs verification'};
 return {pass:c.min>=config.minAnnualBaseUsd,reason:c.min>=config.minAnnualBaseUsd?'Published base range meets floor':'Published base range starts below salary floor'};
}
export function evaluate(job, config) {
 const levels=terms(job.title,config.titleLevels), fields=terms(job.title,config.titleFields), local=terms(job.location,config.localCities);
 const restricted=/\b(except|excluding|outside|canada|europe|uk|hybrid|on.?site)\b/i.test(job.location);
 const remote=/\bremote\b/i.test(job.location)&&/\b(united states|u\.?s\.?a?\.?|nationwide)\b/i.test(job.location)&&!restricted;
 const reasons=[];
 if(!levels.length) reasons.push('Title does not match selected level');
 if(!fields.length) reasons.push('Title does not match selected field');
 if(!local.length&&!remote) reasons.push('Location needs review');
 if(/\b(intern|internship|unpaid)\b/i.test(job.title)) reasons.push('Excluded title');
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
export function historyMatch(job,rows) {
 const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 return rows.find(r=>(r.posting&&job.url&&(()=>{try{return canonical(r.posting)===canonical(job.url)}catch{return false}})())||(norm(r.company)&&norm(r.company)===norm(job.company)&&norm(r.role)&&norm(r.role)===norm(job.title)))??null;
}
