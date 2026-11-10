const allowed = new Set(['greenhouse', 'lever', 'ashby']);
export function ashbySalary(compensation){
 const rows=(compensation?.compensationTiers||[]).flatMap(t=>(t.components||[]).map(c=>({...c,tier:t.title||'',tierSummary:t.tierSummary||''})));
 const salary=rows.filter(c=>c.compensationType==='Salary'&&c.interval==='1 YEAR'&&c.currencyCode==='USD'&&Number.isFinite(c.minValue)&&Number.isFinite(c.maxValue)&&c.minValue>=0&&c.maxValue>=c.minValue&&!/\bOTE\b|on.target|total compensation|total cash|commission/i.test(c.summary+' '+c.tier+' '+c.tierSummary));
 if(!salary.length)return null;
 return {min:Math.min(...salary.map(c=>c.minValue)),max:Math.max(...salary.map(c=>c.maxValue)),currency:'USD',interval:'year',evidence:'Employer Ashby API: minimum across all published USD annual Salary tiers; Bonus/Equity excluded'};
}
function ashbyLocation(job){const countries=[job.address?.postalAddress?.addressCountry,...(job.secondaryLocations||[]).map(l=>l.address?.addressCountry)].filter(Boolean);return job.isRemote&&countries.some(c=>/^(United States|USA|US)$/i.test(c))?'Remote, United States':job.location||'';}
const usLocation=location=>/\b(?:United States|USA|US)\b/i.test(location||'')&&!/\bCanada|Europe|United Kingdom|Australia\b/i.test(location||'');
const otherPeriod=/\b(?:hourly|monthly|weekly|daily|CAD|AUD|GBP|EUR)\b|per\s+(?:hour|month|week|day)\b/i;
export function salaryFromText(raw,{allowAnnualBaseAssumption=false,location}={}) {
 const text=String(raw).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&(?:amp;)?mdash;/g,'—').replace(/&(?:amp;)?ndash;/g,'–').replace(/&#36;|&dollar;/g,'$').replace(/\s+/g,' ');
 const assumption=allowAnnualBaseAssumption===true&&usLocation(location);
 const m=text.match(/(?:annual\s+)?base\s+(?:salary|pay|compensation)[^.]{0,90}?\$([\d,]+)\s*(?:-|–|—|to)\s*\$([\d,]+)/i)|| (assumption?text.match(/\$([\d,]+)\s*(?:-|–|—|to)\s*\$([\d,]+)\s+base\s+(?:salary|pay|compensation)/i):null);
 if(!m)return null;const context=text.slice(Math.max(0,m.index-50),m.index+m[0].length+90);
 const annual=/\b(annual|annually|per year|yearly|a year)\b/i.test(context);
 if((!annual&&!assumption)||otherPeriod.test(context))return null;
 const min=Number(m[1].replaceAll(',','')),max=Number(m[2].replaceAll(',',''));if(min<1000||max<min)return null;
 return {min,max,currency:'USD',interval:'year',...(!annual?{periodAssumed:true}:{}),evidence:m[0]+(!annual?' — applicant-authorized conventional US annual-base assumption':'')};
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
  const seenAt = new Date().toISOString();
  return rows.map(j => ({
    company: board.company, title: j.title || j.text || '',
    location: board.type==='ashby'?ashbyLocation(j):typeof j.location === 'string' ? j.location : j.location?.name || j.categories?.location || '',
    url: j.absolute_url || j.hostedUrl || j.jobUrl || '',
    source: `${board.type}/${board.slug}`, seenAt,
    description: j.content || j.descriptionPlain || j.descriptionHtml || j.description || '',
    sourceId: String(j.id),
    compensation: board.type==='ashby'?ashbySalary(j.compensation):salaryFromText(j.content || j.descriptionPlain || j.descriptionHtml || ''),
  })).filter(j => j.title && /^https:\/\//.test(j.url));
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
  return {title:j.title,location:j.location?.name||'',compensation:pay,posting:job.url,sourceUrl};
 }
 return null;
}
