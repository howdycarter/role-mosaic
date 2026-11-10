import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, formDigest, postingKey } from './applications.js';
import { optionForAnswer, sameAnswer } from './application-values.js';

export function postingLocation(text){
 const header=String(text).slice(0,1500);
 if(/\bexcept\b|\bexcluding\b|only (?:candidates|residents)|not eligible|must (?:reside|live|relocate)/i.test(header))return 'Location restrictions require review';
 if(/\bremote\s*[-,–]?\s*(?:us(?:a)?|united states)\b/i.test(header))return 'Remote, United States';
 // Some postings explicitly allow US remote work after a hybrid office header.
 // The exception must not contradict an actual minimum qualification.
 const qualifications=String(text).split(/Minimum Qualifications:/i)[1]?.split(/Preferred Qualifications:/i)[0];
 if(qualifications&&/Most US-based positions can also be performed remotely/i.test(header)&&!/on[- ]?site|in[- ]office|must (?:reside|live|relocate)|not (?:eligible for|available for) remote/i.test(qualifications))return 'Remote, United States';
 return header;
}

/** A Codex Browser transport. All page reads are DOM-backed; writes use visible AX/locator/file-chooser actions. */
export class CodexBrowserAdapter {
 constructor(browser,{home,existingTabs={},verifiedReadbacks={},uploadedResumes={}}={}){this.browser=browser;this.home=home;this.verifiedReadbacks=verifiedReadbacks;this.uploads=uploadedResumes;this.existingTabs=existingTabs;this.tabs=new Map();this.estimatedCostUsd=0;}
 async inspect(job,{tabId}={}){
  const known=tabId||this.existingTabs[job.id]||this.tabs.get(job.id)?.id;
  const tab=known?await this.browser.tabs.get(known):await this.browser.tabs.new();
  if(!known)await tab.goto(job.url);
  this.tabs.set(job.id,tab);
  // Observe the actual UI before deriving selectors or taking an action.
  await tab.ax.get('state',{disableDiffing:true});
  const view=await tab.playwright.evaluate(()=>{
   const text=document.body.innerText;
   const main=text.split(/Apply for this job|Submit your application|Apply for this position/)[0];
   const fields=[...document.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden'&&(e.type==='file'||e.getAttribute('aria-hidden')!=='true'&&(getComputedStyle(e).opacity!=='0'||e.getAttribute('role')==='combobox')&&e.getClientRects().length>0&&e.getBoundingClientRect().width>1&&e.getBoundingClientRect().height>1)).map(e=>{
    const labels=[...(e.labels||[])].map(l=>l.textContent.trim()).filter(Boolean);
    const aria=(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent?.trim()||'').filter(Boolean).join(' ');
    const parent=e.closest('[class*="field"], [class*="question"]');
    const selected=e.closest('[class*="select__control"]')?.querySelector('[class*="single-value"], [class*="singleValue"]');
    const countryFlag=selected?.querySelector('[class*="iti__flag"]')?.className.match(/\biti__([a-z]{2})\b/)?.[1];
    const label=(labels.join(' ')||e.getAttribute('aria-label')||aria||parent?.querySelector('label')?.textContent||'').replace(/\s+/g,' ').trim();
    return {id:e.id,label,triggerSelector:e.type==='file'&&e.id&&e.parentElement.querySelector('button')?e.parentElement.tagName.toLowerCase()+':has(> input#'+CSS.escape(e.id)+') > button':null,type:e.type==='file'?'file':e.tagName==='SELECT'||e.getAttribute('role')==='combobox'?'select':e.type||'text',required:e.required||e.getAttribute('aria-required')==='true'||/\*/.test(label),value:e.type==='file'?'':e.id==='country'&&countryFlag==='us'?'United States':e.value||selected?.textContent?.trim()||'',options:e.tagName==='SELECT'?[...e.options].map(o=>o.textContent.trim()):[]};
   });
   const buttons=[...document.querySelectorAll('button,input[type="submit"]')].filter(e=>e.getClientRects().length>0).map(e=>({label:(e.innerText||e.value||e.getAttribute('aria-label')||'').trim(),id:e.id}));
   const heading=[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim());
   return {url:location.href,title:document.title,headings:heading,text,main,fields,buttons};
  });
  for(const field of view.fields){const evidence=this.verifiedReadbacks[job.id]?.[field.id];if(field.value==='<redacted>'&&evidence?.value&&evidence?.evidence){field.value=evidence.value;field.readbackEvidence=evidence.evidence;}}
  if(new URL(view.url).origin!==new URL(job.url).origin||postingKey(view.url)!==postingKey(job.url))throw Error('Browser tab is no longer on the intended posting');
  const norm=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const titleVerified=view.headings.some(h=>norm(h)===norm(job.title));
  const location=postingLocation(view.main);
  const files=view.fields.filter(f=>f.type==='file');
  const uploaded=this.uploads[job.id];
  const resume=files.find(f=>/resume|cv/i.test(f.label+' '+f.id))||(uploaded?.sha256&&view.text.includes(uploaded.filename)?{id:'resume',label:uploaded.label,attached:true,filename:uploaded.filename}:null);
  const submit=view.buttons.filter(b=>/^(submit(?: application)?|send application|apply now)$/i.test(b.label));
  const form={fields:view.fields.filter(f=>f.type!=='file'),resume,submit:submit.length===1?submit[0]:null};
  return {job,tab,tabId:tab.id,url:view.url,titleVerified,description:view.main,location,form,closed:/job (?:is no longer|has been filled)|position (?:is no longer|has been filled)|no longer accepting applications/i.test(view.text),login:/create account|sign in to apply/i.test(view.text)&&!resume,captcha:/verify you are human|complete the captcha|i.m not a robot/i.test(view.text)};
 }
 async index(tab,field){return axIndex(String(await tab.ax.get('state',{disableDiffing:true})),field);}
 async fill(inspection,actions,resume){
  const tab=inspection.tab;
  for(const {field,value} of actions){
   this.lastControl=field.label;
   if(field.value&&sameAnswer(field,field.value,value))continue;
   const index=await this.index(tab,field);
   if(field.type==='select'){
    const before=String(await tab.ax.get('state',{disableDiffing:true}));
    if(!before.split('\n').some(line=>new RegExp('^\\s*'+index+' combo box \\(expanded').test(line))){await tab.ax.click(index);await tab.ax.get('state');}
    // The popup options are fresh visible controls; choose only an exact known answer.
    const options=await tab.playwright.evaluate(()=>[...document.querySelectorAll('[role="option"]')].filter(e=>e.getClientRects().length>0).map(e=>e.textContent.trim()));
    const choice=optionForAnswer(field,value,options);
    if(!choice&&options.length===0){
     // Native select popup: use the observed field id and its DOM options.
     if(field.options.includes(value)&&field.id){await tab.playwright.locator('#'+field.id.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c)).selectOption({label:value});}
     else throw Error('Required option is not visible; manual selection required');
    }else if(choice){await tab.playwright.getByRole('option',{name:choice,exact:true}).click();}
    else throw Error('No exact option matches the verified applicant answer');
   }else if(field.type==='checkbox')throw Error('Consent and checkbox answers require a separate manual review');
   else await tab.ax.paste(index,value);
   await tab.ax.get('state');
  }
  this.lastControl='Resume upload';
  if(inspection.form.resume.attached&&this.uploads[inspection.job.id]?.sha256===digest(await readFile(resume)))return {resumeUpload:this.uploads[inspection.job.id]};
  const chooserPromise=tab.playwright.waitForEvent('filechooser',{timeoutMs:10000});
  if(!inspection.form.resume.triggerSelector)throw Error('No supported visible upload trigger');
  await tab.playwright.locator(inspection.form.resume.triggerSelector).click();
  const chooser=await chooserPromise;await chooser.setFiles([path.resolve(resume)]);await tab.ax.get('state');
  this.uploads[inspection.job.id]={filename:path.basename(resume),label:inspection.form.resume.label,sha256:digest(await readFile(resume)),uploadedAt:new Date().toISOString()};
  return {resumeUpload:this.uploads[inspection.job.id]};
 }
 restoreEvidence(jobId,evidence){if(evidence?.resumeUpload)this.uploads[jobId]=evidence.resumeUpload;}
 async verify(inspection,actions,resume){
  const current=await this.inspect(inspection.job,{tabId:inspection.tabId});
  if(!current.titleVerified||formDigest(current.form)!==formDigest(inspection.form))return {ok:false,reason:'Posting or form structure changed'};
  for(const {field,value} of actions){
   const actual=current.form.fields.find(f=>field.id?f.id===field.id:f.label===field.label);
   if(!actual||!sameAnswer(field,actual.value,value))return {ok:false,reason:'An applicant answer did not match readback'};
  }
  const state=String(await inspection.tab.ax.get('state',{disableDiffing:true}));
  const basename=path.basename(resume);
  if(!state.includes(basename))return {ok:false,reason:'Attached resume filename is not visible'};
  if(current.captcha)return {ok:false,captcha:true,reason:'Human CAPTCHA verification required'};
  return {ok:true};
 }
 async submit(inspection){
  await inspection.tab.ax.get('state');
  await inspection.tab.playwright.getByRole('button',{name:inspection.form.submit.label,exact:true}).click();
  await inspection.tab.ax.get('state');
 }
 async confirm(inspection,{waitMs=8000}={}){
  const deadline=Date.now()+waitMs;
  do{
   const text=String(await inspection.tab.ax.get('state',{disableDiffing:true}));
   const page=await inspection.tab.playwright.evaluate(()=>({url:location.href,hasInputs:[...document.querySelectorAll('input,textarea,select')].some(e=>e.type!=='hidden'&&e.type!=='file'&&e.getAttribute('aria-hidden')!=='true'&&e.getClientRects().length>0),hasSubmit:[...document.querySelectorAll('button,input[type="submit"]')].some(e=>e.getClientRects().length>0&&/^(submit(?: application)?|send application)$/i.test((e.innerText||e.value||'').trim()))}));
   const confirmed=new URL(page.url).origin===new URL(inspection.job.url).origin&&postingKey(page.url)===postingKey(inspection.job.url)&&!page.hasInputs&&!page.hasSubmit&&/your application (?:was successfully submitted|has been (?:received|submitted))|thank you for (?:applying|your application)|application submitted successfully/i.test(text)&&! /\b(?:error|please complete|required field)\b/i.test(text);
   if(confirmed){
    const directory=path.join(this.home,'receipts');await mkdir(directory,{recursive:true,mode:0o700});
    const screenshot=path.join(directory,inspection.job.id+'.png');await writeFile(screenshot,await inspection.tab.screenshot({fullPage:false}),{mode:0o600});
    return {confirmed:true,posting:page.url,text:text.slice(0,12000),screenshot,tabId:inspection.tabId};
   }
   if(/verify you are human|complete the captcha|i.m not a robot|please complete|required field/i.test(text))break;
   if(Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,300));
  }while(Date.now()<deadline);
  return {confirmed:false,posting:inspection.job.url};
 }

}

/** Match the current accessibility tree, with a label fallback when the browser omits a DOM id. */
export function axIndex(state,field){
 const controls=state.split('\n').map(line=>{
  const m=/^\s*(\d+) (?:text field|text entry area|combo box|checkbox|button)(?: \([^)]*\))?\s*(.*)$/.exec(line);
  if(!m)return null;
  return {index:Number(m[1]),id:line.match(/\bID:\s*([^,\n]+)/)?.[1]?.trim(),label:m[2].replace(/^Description:\s*/,'').split(/,\s*(?:Value|ID|Secondary Actions):/)[0].trim()};
 }).filter(Boolean);
 const identified=field.id?controls.filter(c=>c.id===field.id):[];
 if(identified.length===1)return identified[0].index;
 const norm=s=>s.replace(/[*:]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
 const named=controls.filter(c=>norm(c.label)===norm(field.label));
 if(named.length===1)return named[0].index;
 throw Error('A unique visible application control could not be identified');
}
