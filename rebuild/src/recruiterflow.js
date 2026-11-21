import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {boundedFile} from './career.js';
import {qualityDigest} from './quality.js';

// The observed public guest form is currently supported for this recruiter only.
export function recruiterflowRoute(raw) {
  try {
    const url=new URL(raw);
    const m=/^\/rethinkrecruit\/jobs\/([1-9]\d*)$/.exec(url.pathname);
    if (!m || url.origin!=='https://recruiterflow.com' || url.username || url.password || url.search || url.hash || url.href!==raw) return null;
    return {posting:url.href,id:m[1],publisher:'Rethink Recruit'};
  } catch { return null; }
}

const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];

export function monthValue(input) {
  const text=String(input||'').trim();
  if (!text) return '';
  if (/^(?:19|20)\d\d-(?:0[1-9]|1[012])$/.test(text)) return text;
  let match=/^(0?[1-9]|1[0-2])[/-]((?:19|20)\d\d)$/.exec(text);
  if (match) return match[2]+'-'+match[1].padStart(2,'0');
  match=/^([A-Za-z]{3,9})[,.]?\s+((?:19|20)\d\d)$/.exec(text);
  const idx=match?monthNames.findIndex(m=>[m,m.slice(0,3)].includes(match[1])):-1;
  return idx===-1?null:match[2]+'-'+String(idx+1).padStart(2,'0');
}

// Each reference selects one complete, concluded position from a hash-checked
// private Notion export. Every employer-facing field comes from that same row.
export async function recruiterflowExperience(store,job,ctx) {
  const ref=(await store.read('posting-experience.json',{}))[job.id];
  if (!ref || ref.posting!==job.url || ref.resumeSha256!==ctx.resumeSha256 || ref.profileSha256!==ctx.profileSha256) return {};
  const sources=(await store.read('career-evidence.json',{})).sources||[];
  const source=sources.find(s=>s.id===ref.sourceId);
  if (!source || source.sha256!==ref.sourceSha256) return {};
  const file=path.resolve(store.root,source.path);
  if (!file.startsWith(store.root+path.sep)) return {};
  const data=await boundedFile(file);
  if (qualityDigest(data)!==source.sha256) return {};
  const rows=[...data.toString('utf8').matchAll(/^### ([^\n]+)\r?\n\s*<b>([^<\n]+)<\/b>\s*\\?\|[^\n|]+\\?\|\s*([A-Za-z]+ \d{4})\s+[–—-]\s+([A-Za-z]+ \d{4})\s*$/gm)]
    .filter(([,title,company])=>title===ref.title && company===ref.company);
  if (rows.length!==1) return {};
  const [,title,company,from,to]=rows[0], start=monthValue(from), end=monthValue(to);
  if (!start || !end || end<start || end>new Date().toISOString().slice(0,7)) return {};
  return {company,title,start,end};
}

export function recruiterflowCompensation(description, location, fullTime, allowAnnual) {
  if (!allowAnnual || !fullTime || location!=='Austin, TX' || !/\bbased in Austin\b/i.test(description)) return null;
  const clauses=[...description.matchAll(/(?:^|\n)Starting base around \$([1-9]\d{2})K\b([^\n.]*)/gi)];
  if (clauses.length!==1 || /(?:per hour|per month|hourly|monthly|CAD|AUD|OTE|commission)/i.test(clauses[0][0])) return null;
  const amount=Number(clauses[0][1])*1000;
  return {currency:'USD',interval:'year',min:amount,max:amount,evidence:clauses[0][0].trim(),
    assumption:'Approximate current starting base for a full-time US posting. Conditional future financing excluded.'};
}

function scope(job,uploaded) {
  const route=recruiterflowRoute(job.url),parts=String(job.company||'').split(' / ');
  if (!route || job.source!=='recruiterflow' || String(job.sourceId)!==route.id ||
      parts.length!==2 || parts[0]!==route.publisher || !parts[1].trim() || !job.title?.trim() || !job.description?.trim()) throw Error('Recruiterflow recipient or posting is unverified');
  return {...route,title:job.title,client:parts[1],description:job.description,uploaded};
}

export function observeRecruiterflow(expected) {
  const fail=reason=>{throw Error('Recruiterflow guest form changed: '+reason);};
  const one=(root,selector)=>{const items=root.querySelectorAll(selector);if(items.length!==1)fail(selector);return items[0];};
  const text=(root,selector)=>one(root,selector).innerText.trim();
  if (location.href!==expected.posting || text(document,'.header-title')!==expected.title ||
      document.title.toLowerCase()!==('Apply to '+expected.title+' at '+expected.publisher).toLowerCase()) fail('posting identity');
  const description=text(document,'.rf-careers-job-description-container');
  if (description!==expected.description) fail('reviewed job description');
  if (!description.split(/\r?\n/).some(line=>line.trim().toUpperCase()==='WHY '+expected.client.toUpperCase()+' EXISTS')) fail('named hiring company');
  const form=one(document,'#rf-application-form-scroll-target[data-testid="application-form-container-root"] form');
  const root=form.closest('#rf-application-form-scroll-target');
  if (form.hasAttribute('action') || form.hasAttribute('target') || form.querySelector('a[href]') ||
      /\b(?:agree|consent|attest|arbitration|terms of|privacy policy|by (?:submitting|clicking)|certify|waive)\b/i.test(root.innerText)) fail('terms or destination');
  const labels=new Set([...form.querySelectorAll('.form-label')].map(e=>e.innerText.trim()).filter(Boolean));
  const expectedLabels=['Upload Resume *','Full Name *','Email *','Phone','Experience *'];
  if(labels.size!==expectedLabels.length || expectedLabels.some(l=>!labels.has(l))) fail('questions');
  const tests=[
    ['input-resume-upload','fileInput','file',''],['input-personal-name-first-name','rf-application-form-first-name','text','First name'],
    ['input-personal-name-last-name','rf-application-form-last-name','text','Last name'],['input-personal-email','rf-application-form-email','email','Email address'],
    ['input-personal-phone','user-phone','tel','Enter phone number'],['input-experience-0-company','rf-application-form-company','text','Company Name'],
    ['input-experience-0-title','rf-application-form-title','text','Title'],['checkbox-experience-0-current','data-policy','checkbox',''],
    ['input-experience-0-start-date','','text','Start Date'],['input-experience-0-end-date','','text','End Date']
  ];
  const elements={}, css=id=>'[data-testid="application-form-'+id+'"]';
  for (const [id,nodeId,type,placeholder] of tests) {
    const element=one(form,css(id));
    if (element.tagName!=='INPUT' || element.id!==nodeId || element.type!==type || element.placeholder!==placeholder || element.disabled) fail(id);
    elements[id]=element;
  }
  const known=new Set(Object.values(elements));
  if([...form.querySelectorAll('input,textarea,select,[contenteditable="true"],[role="checkbox"],[role="radio"]')].some(e=>!known.has(e)))fail('additional controls');
  const current=elements['checkbox-experience-0-current'];
  if (current.parentElement?.querySelector('label.current-checkbox-label')?.innerText.trim()!=='I am currently working in this role' || current.checked)fail('current experience');
  const submit=one(form,css('button-submit'));
  if (submit.id!=='submit-application-button' || submit.tagName!=='BUTTON' || submit.innerText.trim()!=='Submit Application')fail('submit');
  const allowedButtons=['button-submit','button-personal-phone-country','button-add-experience','button-remove-resume'];
  if([...form.querySelectorAll('button')].some(e=>!e.closest('.react-datepicker') && !allowedButtons.some(id=>e.matches(css(id)))))fail('additional button');
  const names=[
    ['input-personal-name-first-name','First name'],['input-personal-name-last-name','Last name'],['input-personal-email','Email'],
    ['input-experience-0-company','Experience company name','company'],['input-experience-0-title','Experience title','title'],
    ['input-experience-0-start-date','Experience start month','start'],['input-experience-0-end-date','Experience end month','end']
  ];
  const phone=elements['input-personal-phone'];
  if(phone.value && !/^\s*(?:\+?1)?\s*$/.test(phone.value))names.push(['input-personal-phone','Phone']);
  const fields=names.map(([id,label,experienceKey])=>({id,selector:css(id),label,experienceKey,
    type:elements[id].type,required:true,value:elements[id].value}));
  const file=elements['input-resume-upload'], attachment=file.files?.[0]?.name||'';
  if (attachment && attachment!==expected.uploaded) fail('unverified attachment');
  const formText=root.innerText, headers=[...document.querySelectorAll('.header-title')];
  const fullTime=headers.length===1 && /\bFULL TIME\b/i.test(headers[0].parentElement.innerText);
  return {description,location:text(document,'.location-text'),fullTime,
    captcha:/verify (?:you are|that you are) human|I.m not a robot/i.test(formText) ||
      [...document.querySelectorAll('iframe')].some(e=>e.getClientRects().length && /captcha|challenge/i.test(e.title+' '+e.src)),
    form:{fields,resume:{id:'fileInput',selector:css('input-resume-upload'),type:'file',label:'Upload Resume',required:true,
      attached:!!expected.uploaded && (attachment===expected.uploaded || formText.includes(expected.uploaded))},
      submit:{id:submit.id,label:submit.innerText.trim()}}};
}

export async function inspectRecruiterflow({job,tab,uploaded,allowAnnual}) {
  const expected=scope(job,uploaded),page=tab.page;
  await page.locator('#rf-application-form-scroll-target form #submit-application-button').waitFor({state:'visible'});
  const view=await page.evaluate(observeRecruiterflow,expected);
  for (const field of view.form.fields.filter(f=>['start','end'].includes(f.experienceKey))) {
    const value=monthValue(field.value);
    if (value===null) throw Error('Recruiterflow experience date format is unverified');
    field.value=value;
  }
  const compensation=recruiterflowCompensation(view.description,view.location,view.fullTime,allowAnnual);
  return {...view,job,tab,tabId:tab.id,url:expected.posting,titleVerified:true,closed:false,login:false,compensation,
    publicEvidence:{sourceUrl:expected.posting,posting:expected.posting}};
}

export async function guardRecruiterflow(page,job,uploaded) {
  if(recruiterflowRoute(job.url)) await page.evaluate(observeRecruiterflow,scope(job,uploaded));
}

export async function fillRecruiterflowMonth(field,control,value) {
  if(!['start','end'].includes(field.experienceKey))return false;
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value))throw Error('Verified experience month is required');
  const [year,month]=value.split('-').map(Number);
  await control.click();
  const picker=control.page().locator('.react-datepicker:visible');
  const first=picker.getByRole('option').first();
  const shown=Number((await first.getAttribute('aria-label'))?.match(/(\d{4})$/)?.[1]);
  if(!shown || Math.abs(year-shown)>70) throw Error('Experience month picker year is unknown');
  const button=year<shown?'Previous Year':'Next Year';
  for(let i=0;i<Math.abs(year-shown);i++)await picker.getByRole('button',{name:button,exact:true}).click();
  await picker.getByRole('option',{name:'Choose '+monthNames[month-1]+' '+year,exact:true}).click();
  if(monthValue(await control.inputValue())!==value)throw Error('Experience month selection did not match');
  return true;
}

export async function confirmRecruiterflow({home,job,tab,tabId},{waitMs=8000}={}) {
  const route=recruiterflowRoute(job.url);
  const deadline=Date.now()+waitMs;
  do {
    if(!route || tab.page.url()!==route.posting)break;
    const result=await tab.page.evaluate(expected=>{
      if(location.href!==expected.posting || document.title.toLowerCase()!==('Apply to '+expected.title+' at '+expected.publisher).toLowerCase())return null;
      const text=document.body.innerText;
      if (document.querySelector('#rf-application-form-scroll-target form') || /already (?:applied|submitted)|unsuccessful|failed|error|not submitted|verify your email|verification required/i.test(text))return null;
      if(!/your application (?:was|has been) (?:successfully )?(?:submitted|received)|application submitted successfully|thank you for (?:applying|your application)/i.test(text))return null;
      return text.slice(0,12000);
    },{...route,title:job.title});
    if(result){
      const dir=path.join(home,'receipts');await mkdir(dir,{recursive:true,mode:0o700});
      const screenshot=path.join(dir,job.id+'.png');
      await writeFile(screenshot,await tab.screenshot({fullPage:false}),{mode:0o600});
      return {confirmed:true,posting:route.posting,text:result,screenshot,tabId};
    }
    if(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,240));
  }while(Date.now()<deadline);
  return {confirmed:false,posting:job.url};
}
