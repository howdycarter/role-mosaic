import {ashbyLocation,nationwideUSRemote,requiresLocalResidence} from './location.js';
import {htmlText} from './career.js';
const allowed = new Set(['greenhouse', 'lever', 'ashby']);
function listingLocation(label,description) {
 if(!description||!nationwideUSRemote(label)||!/\b(?:must|need to|required to)\b/i.test(description))return label;
 const text=description.includes('<')||description.includes('&lt;')?htmlText(htmlText(description)):description;
 return requiresLocalResidence(text)?'Location restrictions require review':label;
}
export function ashbySalary(compensation){
 const rows=(compensation?.compensationTiers||[]).flatMap(t=>(t.components||[]).map(c=>({...c,tier:t.title||'',tierSummary:t.tierSummary||''})));
 const salary=rows.filter(c=>c.compensationType==='Salary'&&c.interval==='1 YEAR'&&c.currencyCode==='USD'&&Number.isFinite(c.minValue)&&Number.isFinite(c.maxValue)&&c.minValue>=0&&c.maxValue>=c.minValue&&!/\bOTE\b|on.target|total compensation|total cash|commission/i.test(c.summary+' '+c.tier+' '+c.tierSummary));
 if(!salary.length)return null;
 const min=Math.min(...salary.map(c=>c.minValue)),max=Math.max(...salary.map(c=>c.maxValue));
 const tierCeiling=salary.length>1?{lowestTierMaximum:Math.min(...salary.map(c=>c.maxValue))}:{};
 return {min,max,...tierCeiling,currency:'USD',interval:'year',evidence:'Employer Ashby API: bounds across published annual USD salary tiers. Applicant tier unverified.'};
}
const usLocation=location=>(/\b(?:United States|USA|US)\b/i.test(location||'')||/\b[A-Z][a-z]+(?: [A-Z][a-z]+)*,?\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/.test(location||''))&&!/\bCanada|Europe|United Kingdom|Australia\b/i.test(location||'');
const otherPeriod=/\b(?:hourly|monthly|weekly|daily|CAD|AUD|GBP|EUR)\b|per\s+(?:hour|month|week|day)\b/i;
export function salaryFromText(raw,{allowAnnualBaseAssumption=false,location}={}) {
 const text=String(raw).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&(?:amp;)?mdash;/g,'—').replace(/&(?:amp;)?ndash;/g,'–').replace(/&#36;|&dollar;/g,'$').replace(/\s+/g,' ');
 const assumption=allowAnnualBaseAssumption===true&&usLocation(location);
 const m=text.match(/(?:annual\s+)?base\s+(?:salary|pay|compensation)[^.]{0,90}?\$([\d,]+(?:\.\d+)?)(k?)\s*(?:-|–|—|to)\s*\$?([\d,]+(?:\.\d+)?)(k?)\b/i)|| (assumption?text.match(/\$([\d,]+(?:\.\d+)?)(k?)\s*(?:-|–|—|to)\s*\$?([\d,]+(?:\.\d+)?)(k?)\s+base\s+(?:salary|pay|compensation)/i):null);
 if(!m)return null;const context=text.slice(Math.max(0,m.index-50),m.index+m[0].length+90);
 if(mixedCompensation(m[0].split('$')[0],text.slice(m.index+m[0].length)))return null;
 const annual=/\b(annual|annually|per year|yearly|a year)\b/i.test(context);
 if((!annual&&!assumption)||otherPeriod.test(context))return null;
 const min=Number(m[1].replaceAll(',',''))*(m[2]?1000:1),max=Number(m[3].replaceAll(',',''))*(m[4]?1000:1);if(min<1000||max<min)return null;
 return {min,max,currency:'USD',interval:'year',...(!annual?{periodAssumed:true}:{}),evidence:m[0]+(!annual?' — applicant-authorized conventional US annual-base assumption':'')};
}
// Reject an amount explicitly attributed to variable or aggregate compensation.
// A separately listed bonus after an unambiguous base range remains valid.
export function mixedCompensation(prefix,suffix) {
 const variable=/\b(?:OTE|on[- ]target earnings|total (?:cash|compensation)|commission|equity|bonus)\b/i;
 return variable.test(prefix)||/^\s*(?:USD\s*)?[(,:–—-]?\s*(?:OTE\b|on[- ]target earnings\b|(?:in |of )?total (?:compensation|cash)\b|including (?:commission|bonus|equity)\b)/i.test(suffix);
}
export function employerPostingUrl(boardType,raw,sourceId) {
 if(typeof raw!=='string'||!/^https?:\/\//i.test(raw)||/[\s\\]/.test(raw)||!URL.canParse(raw))throw Error('Incomplete employer posting URL in board response');
 const url=new URL(raw);
 if(url.username||url.password)throw Error('Invalid employer posting URL in board response');
 if(url.protocol==='https:')return raw;
 const id=String(sourceId),queryIds=url.searchParams.getAll('gh_jid');
 const authority=raw.slice('http://'.length).split(/[/?#]/)[0];
 const official=['boards.greenhouse.io','job-boards.greenhouse.io'].includes(url.hostname)&&url.pathname.match(/^\/[^/]+\/jobs\/(\d+)\/?$/)?.[1]===id;
 const bound=queryIds.length===1&&queryIds[0]===id;
 if(boardType!=='greenhouse'||!/^\d+$/.test(id)||authority.includes(':')||!(bound||official&&queryIds.length===0))throw Error('Unverified employer posting URL in board response');
 url.protocol='https:';
 return url.href;
}
export async function fetchBoard(board, fetcher = fetch) {
  if (!allowed.has(board.type) || !/^[a-zA-Z0-9_. -]{1,100}$/.test(board.slug)) throw new Error('Invalid board type or slug');
  const slug=encodeURIComponent(board.slug);
  const endpoints = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,
  };
  const response = await fetcher(endpoints[board.type], { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`${board.type}/${board.slug}: HTTP ${response.status}`);
  const body = await response.json();
  const rows = board.type === 'lever' ? body : body.jobs;
  if (!Array.isArray(rows)) throw new Error('Unexpected board response');
  if ((board.type === 'greenhouse' && body.meta?.total != null && body.meta.total !== rows.length) ||
      body.hasMore === true || body.nextPage || body.meta?.nextPage) throw new Error('Incomplete employer board response');
  const seenAt = new Date().toISOString();
  const jobs = rows.filter(j => board.type !== 'ashby' || j?.isListed !== false).map(j => ({
    company: board.company, title: j.title || j.text || '',
    location: listingLocation(board.type==='ashby'?ashbyLocation(j):typeof j.location === 'string' ? j.location : j.location?.name || j.categories?.location || '',j.descriptionPlain || j.content || j.descriptionHtml || j.description),
    url: employerPostingUrl(board.type,j.absolute_url || j.hostedUrl || j.jobUrl,j.id),
    source: `${board.type}/${board.slug}`, seenAt,
    description: j.content || j.descriptionPlain || j.descriptionHtml || j.description || '',
    sourceId: String(j.id),
    compensation: board.type==='ashby'?ashbySalary(j.compensation):salaryFromText(j.content || j.descriptionPlain || j.descriptionHtml || ''),
  }));
  for(const job of jobs){
    if(typeof job.title!=='string'||!job.title.trim())throw new Error('Incomplete employer posting in board response');
  }
  return jobs;
}

export async function livePostingEvidence(job,fetcher=fetch,rules={}){
 const url=new URL(job.url),parts=url.pathname.split('/').filter(Boolean),slug=decodeURIComponent(parts[0]||'');
 if(!/^[a-zA-Z0-9_. -]{1,100}$/.test(slug))return null;
 if(url.hostname==='jobs.ashbyhq.com'){
  const jobs=await fetchBoard({type:'ashby',slug,company:job.company},fetcher),id=parts[1];
  const found=jobs.find(j=>new URL(j.url).pathname.split('/').filter(Boolean)[1]===id);return found?{...found,posting:job.url,sourceUrl:'https://api.ashbyhq.com/posting-api/job-board/'+encodeURIComponent(slug)+'?includeCompensation=true'}:null;
 }
 if(['job-boards.greenhouse.io','boards.greenhouse.io'].includes(url.hostname)){
  const id=parts[2];if(!/^\d+$/.test(id||''))return null;
  const sourceUrl='https://boards-api.greenhouse.io/v1/boards/'+encodeURIComponent(slug)+'/jobs/'+id+'?pay_transparency=true';
  const response=await fetcher(sourceUrl,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)return null;const j=await response.json();
  if(String(j.id)!==id)return null;
  const metadata=j.metadata||[],fullTime=metadata.some(m=>m.name==='Time Type'&&/^full[ -]?time$/i.test(m.value||'')),salaried=metadata.some(m=>m.name==='Pay Rate Type'&&m.value==='Salary');
  const ranges=(j.pay_input_ranges||[]).filter(r=>r.currency_type==='USD'&&/base (?:salary|compensation)/i.test((r.title||'')+' '+(r.blurb||''))&&!/\bOTE\b|total compensation|hour|month|CAD/i.test((r.title||'')+' '+(r.blurb||''))&&Number.isFinite(r.min_cents)&&Number.isFinite(r.max_cents)&&r.max_cents>=r.min_cents);
  let pay=ranges.length===1&&fullTime&&salaried?{min:ranges[0].min_cents/100,max:ranges[0].max_cents/100,currency:'USD',interval:'year',evidence:'Employer Greenhouse base salary band with Full time / Salary metadata'}:null;
  // GitLab publishes the period in its own compensation handbook, rather
  // than Greenhouse metadata. Never borrow this policy for another employer.
  if(!pay&&slug.toLowerCase()==='gitlab'&&ranges.length===1&&ranges[0].title==='United States Salary Range'&&/base salary range does not include any bonuses, equity, or benefits/i.test(ranges[0].blurb||'')){
   const periodSource='https://handbook.gitlab.com/handbook/total-rewards/compensation/';
   const policy=await fetcher(periodSource,{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(policy.ok&&(await policy.text()).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').includes('Base salary is annual guaranteed pay'))pay={min:ranges[0].min_cents/100,max:ranges[0].max_cents/100,currency:'USD',interval:'year',evidence:'Employer US base-only salary band; annual period verified in employer compensation handbook',periodSource};
  }
  const assumptionAllowed=rules.allowAnnualBaseAssumption===true&&!metadata.some(m=>/part[ -]?time|contract|temporary|hourly|monthly|weekly/i.test(String(m.value||'')));
  if(!pay&&assumptionAllowed&&usLocation(j.location?.name)&&ranges.length===1&&!otherPeriod.test((ranges[0].title||'')+' '+(ranges[0].blurb||''))){
   pay={min:ranges[0].min_cents/100,max:ranges[0].max_cents/100,currency:'USD',interval:'year',periodAssumed:true,evidence:'Employer USD base-only range; applicant-authorized conventional annual-period assumption'};
  }
  if(!pay)pay=salaryFromText(j.content||'',{allowAnnualBaseAssumption:assumptionAllowed,location:j.location?.name});
  return {title:j.title,location:listingLocation(j.location?.name||'',j.content),compensation:pay,posting:job.url,sourceUrl};
 }
 return null;
}
