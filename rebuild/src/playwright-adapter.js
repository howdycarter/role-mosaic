import path from 'node:path';
import {mkdir,chmod,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CodexBrowserAdapter} from './browser-adapter.js';
import {digest,postingKey,supportedPosting} from './applications.js';
import {optionForAnswer,sameAnswer} from './application-values.js';
import {livePostingEvidence} from './sources.js';

// A native transport: no Codex connection, browser extension, CDP attachment,
// user-profile copying, stealth switches, remote debugging port or AI API.
class NativeTabs {
 constructor(context){this.context=context;this.byId=new Map();}
 wrap(page){
  for(const tab of this.byId.values())if(tab.page===page)return tab;
  const tab={id:randomUUID(),page,playwright:page,ax:{get:()=>page.locator('body').innerText()},goto:url=>page.goto(url,{waitUntil:'domcontentloaded'}),screenshot:options=>page.screenshot(options)};
  this.byId.set(tab.id,tab);return tab;
 }
 async new(){return this.wrap(await this.context.newPage());}
 async get(id){const tab=this.byId.get(id);if(!tab||tab.page.isClosed())throw Error('Application tab unavailable; inspect the preserved session');return tab;}
 find(url){return this.context.pages().find(p=>{try{return !p.isClosed()&&new URL(p.url()).origin===new URL(url).origin&&postingKey(p.url())===postingKey(url);}catch{return false;}});}
}

export class PlaywrightApplicationAdapter extends CodexBrowserAdapter {
 constructor(context,{home,evidenceLoader=livePostingEvidence}={}){const tabs=new NativeTabs(context);super({tabs},{home});this.context=context;this.nativeTabs=tabs;this.transport='playwright';this.evidenceLoader=evidenceLoader;}
 static async launch({home,headless=false,channel='chrome',context}={}){
  if(!context){
   const slot=process.env.ROLEMOSAIC_BROWSER_SLOT||'';if(slot&&!/^[a-z0-9-]{1,40}$/.test(slot))throw Error('Invalid private browser slot');
   const directory=path.join(home,'browser-profile'+(slot?'-'+slot:''));await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
   const {chromium}=await import('playwright');
   context=await chromium.launchPersistentContext(directory,{channel:channel==='chromium'?undefined:channel,headless,chromiumSandbox:true,acceptDownloads:false,viewport:{width:1280,height:900},args:['--restore-last-session']});
   context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(30000);
  }
  return new PlaywrightApplicationAdapter(context,{home});
 }
 async inspect(job,{tabId}={}){
  if(!supportedPosting(job.url))throw Error('Unsupported employer host');
  // Native page identities survive a worker restart through their posting URL.
  const remembered=this.nativeTabs.byId.get(tabId);
  const existing=remembered&&!remembered.page.isClosed()?remembered:this.nativeTabs.find(job.url)?this.nativeTabs.wrap(this.nativeTabs.find(job.url)):null;
  if(tabId&&!existing)throw Error('Preserved application page unavailable; no new form was opened');
  const tab=existing||await this.nativeTabs.new();
  if(!existing)await tab.goto(job.url);
  await tab.page.locator('h1').first().waitFor({state:'visible'});
  const applicationText=await tab.page.locator('body').innerText();let overview=applicationText;
  if(new URL(job.url).hostname==='jobs.ashbyhq.com'){
   const application=tab.page.getByRole('tab',{name:'Application',exact:true});
   if(await application.count()===1){if(await application.getAttribute('aria-selected')!=='true')await application.click();await tab.page.locator('input[type="email"],input[type="file"]').first().waitFor({state:'attached',timeout:10000});}
   // Ashby removes overview copy on the Application tab. Retrieve it read-only
   // on a second page, never by reloading an applicant's partially filled form.
   const overviewLink=tab.page.getByRole('tab',{name:'Overview',exact:true});
   if(await overviewLink.count()&&await overviewLink.getAttribute('aria-selected')!=='true'){
    const readOnly=await this.context.newPage();
    try{await readOnly.goto(job.url.replace(/\/application\/?$/,''),{waitUntil:'domcontentloaded'});await readOnly.locator('h1').first().waitFor();overview=await readOnly.locator('body').innerText();}finally{await readOnly.close();}
   }
  }
  const inspection=await super.inspect(job,{tabId:tab.id});
  if(new URL(job.url).hostname==='jobs.ashbyhq.com')inspection.description=overview;
  try{
   const rules=JSON.parse(await readFile(path.join(this.home,'search.json'),'utf8').catch(()=> '{}'));
   const evidence=await this.evidenceLoader(job,undefined,{allowAnnualBaseAssumption:rules.allowAnnualBaseAssumption===true}),norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
   if(evidence&&norm(evidence.title)===norm(job.title)&&evidence.posting===job.url){
    inspection.compensation=evidence.compensation;inspection.publicEvidence={posting:job.url,sourceUrl:evidence.sourceUrl,checkedAt:new Date().toISOString()};
    if(evidence.location==='Remote, United States'&&!/Location Type\s*(?:Hybrid|On.?site)|\bexcept\b|\bexcluding\b|only (?:candidates|residents)|not eligible|must (?:reside|live|relocate)|\brequired.*(?:onsite|on-site|office)\b/i.test(applicationText+'\n'+overview))inspection.location=evidence.location;
   }
  }catch{/* Missing public evidence remains a hold, never a guessed salary. */}
  if(/Location Type\s*(?:Hybrid|On.?site)/i.test(applicationText+'\n'+overview))inspection.location='Location restrictions require review';
  const groups=await tab.page.evaluate(()=>[...document.querySelectorAll('.ashby-application-form-field-entry[data-field-path]')].filter(e=>e.getClientRects().length).flatMap(e=>{
   const buttons=[...e.querySelectorAll('button[aria-pressed]')].filter(b=>b.getClientRects().length),label=e.querySelector('label');
   if(!label)return [];
   if(!buttons.length){const combo=e.querySelector('button[role="combobox"],input[role="combobox"]');return combo?[{id:e.getAttribute('data-field-path'),selector:'[data-field-path='+JSON.stringify(e.getAttribute('data-field-path'))+'] '+combo.tagName.toLowerCase()+'[role="combobox"]',label:label.innerText.trim(),type:'select',required:/required/i.test(label.className)||combo.getAttribute('aria-required')==='true',value:combo.tagName==='INPUT'?combo.value:/^select/i.test(combo.innerText.trim())?'':combo.innerText.trim(),options:[]}]:[];}
   return [{id:e.getAttribute('data-field-path'),selector:'[data-field-path='+JSON.stringify(e.getAttribute('data-field-path'))+']',label:label.innerText.trim(),type:'button-choice',required:/required/i.test(label.className)||label.getAttribute('aria-required')==='true',value:buttons.find(b=>b.getAttribute('aria-pressed')==='true')?.innerText.trim()||'',options:buttons.map(b=>b.innerText.trim())}];
  }));
  const radioGroups=await tab.page.evaluate(()=>[...document.querySelectorAll('fieldset.ashby-application-form-input-radio-group')].filter(e=>e.getClientRects().length).flatMap(e=>{const label=e.querySelector('label.ashby-application-form-question-title'),radios=[...e.querySelectorAll('input[type="radio"]')];if(!label?.htmlFor||!radios.length)return [];const text=r=>[...(r.labels||[])].map(l=>l.innerText.trim()).join(' ');return [{id:label.htmlFor,selector:'fieldset.ashby-application-form-input-radio-group:has(> label[for='+JSON.stringify(label.htmlFor)+'])',label:label.innerText.trim(),type:'radio-choice',required:/required/i.test(label.className),value:radios.find(r=>r.checked)?text(radios.find(r=>r.checked)):'',options:radios.map(text),controlIds:radios.map(r=>r.id)}]}));
  groups.push(...radioGroups);
  const fieldsetCombos=await tab.page.evaluate(()=>[...document.querySelectorAll('fieldset')].filter(e=>e.getClientRects().length&&!e.matches('.ashby-application-form-input-radio-group')).flatMap(e=>{const label=e.querySelector('label.ashby-application-form-question-title'),control=e.querySelector('input[role="combobox"],button[role="combobox"]');return label?.htmlFor&&control?[{id:label.htmlFor,selector:'fieldset:has(> label[for='+JSON.stringify(label.htmlFor)+']) [role="combobox"]',label:label.innerText.trim(),type:'select',required:/required/i.test(label.className),value:control.tagName==='INPUT'?control.value:/^select/i.test(control.innerText.trim())?'':control.innerText.trim(),options:[]}]:[]}));
  groups.push(...fieldsetCombos);
  inspection.form.fields=inspection.form.fields.filter(f=>!groups.some(g=>g.id===f.id||g.type==='select'&&f.type==='select'&&g.label===f.label||g.controlIds?.includes(f.id)));inspection.form.fields.push(...groups);
  for(const field of inspection.form.fields){
   if(inspection.location==='Remote, United States')field.countryContext='US';
   if(field.id&&!field.selector){const control=this.locator(tab,field);if(await control.count()===1){
    const details=await control.evaluate(e=>{const entry=e.closest('.ashby-application-form-field-entry[data-field-path]'),label=entry?.querySelector('.ashby-application-form-question-title,label');const selected=e.closest('[class*="select__control"]')?.querySelector('[class*="multi-value__label"], [class*="multiValueLabel"]');return {required:!!label&&/required/i.test(label.className),selected:selected?.textContent?.trim()||''}});
    field.required=field.required||details.required;if(!field.value&&details.selected)field.value=details.selected;
    if(field.type==='checkbox')field.value=String(await control.isChecked());
   }}
  }
  const ownUpload=this.uploads[job.id];if(ownUpload&&inspection.form.resume&&(await tab.page.locator('body').innerText()).includes(ownUpload.filename))inspection.form.resume.attached=true;
  const unsupported=await tab.page.evaluate(()=>{
   const visible=e=>e.getClientRects().length>0&&e.getBoundingClientRect().width>1&&getComputedStyle(e).visibility!=='hidden';
   const controls=[...document.querySelectorAll('input[type="radio"], [role="radiogroup"],button[role="combobox"], [role="checkbox"]')].filter(visible).filter(e=>!(e.matches('button[role="combobox"]')&&(e.closest('.ashby-application-form-field-entry[data-field-path]')?.querySelector('label')||e.closest('fieldset')?.querySelector('label.ashby-application-form-question-title')?.htmlFor))).filter(e=>!e.closest('fieldset.ashby-application-form-input-radio-group')?.querySelector('label.ashby-application-form-question-title'));
   const labels=controls.map(e=>{const parent=e.closest('.ashby-application-form-field-entry[data-field-path]')||e.closest('fieldset,[class*="field"],[class*="question"]'),heading=parent?.querySelector('.ashby-application-form-question-title,legend,label');return {label:e.getAttribute('aria-label')||heading?.innerText||parent?.innerText||'Unsupported custom application control',required:parent?!!(e.required||e.getAttribute('aria-required')==='true'||/required/i.test(heading?.className||'')):true};});
   // Unlabelled visible inputs cannot safely disappear from required checks.
   return labels.filter((label,index)=>labels.findIndex(other=>other.label===label.label)===index);
  });
  for(const item of unsupported)inspection.form.fields.push({id:'',label:'Manual control: '+item.label.slice(0,240),type:'manual',required:item.required,value:''});
  const requiredLabels=await tab.page.locator('label.ashby-application-form-question-title').evaluateAll(labels=>labels.filter(l=>l.getClientRects().length&&/required/i.test(l.className)).map(l=>l.innerText.trim()));
  const normalized=s=>s.replace(/[*:]/g,'').replace(/\s+/g,' ').trim();
  for(const label of requiredLabels){const fields=inspection.form.fields.filter(f=>normalized(f.label)===normalized(label));if(fields.length===1)fields[0].required=true;else if(!fields.length&&normalized(label)!==normalized(inspection.form.resume?.label||''))inspection.form.fields.push({id:'',label:'Manual control: '+label,type:'manual',required:true,value:''});}
  for(const file of await tab.page.locator('input[type="file"][required]').all()){const id=await file.getAttribute('id');if(id!==inspection.form.resume?.id)inspection.form.fields.push({id:'',label:'Additional required file: '+(id||'unlabelled upload'),type:'manual',required:true,value:''});}
  return inspection;
 }
 locator(tab,field){
  if(field.selector)return tab.page.locator(field.selector);
  if(field.id)return tab.page.locator('[id='+JSON.stringify(field.id)+']');
  return tab.page.getByLabel(field.label.replace(/\*$/,'').trim(),{exact:true});
 }
 async fill(inspection,actions,resume){
  const tab=inspection.tab;
  await tab.page.bringToFront();
  for(const {field,value} of actions){
   this.lastControl=field.label;
   if(field.type!=='select'&&field.value&&sameAnswer(field,field.value,value))continue;
   const control=this.locator(tab,field);
   if(field.type==='radio-choice'){
    const choice=optionForAnswer(field,value,field.options||[]);if(!choice)throw Error('No radio option matches the verified applicant answer');await control.getByRole('radio',{name:choice,exact:true}).check();
   }else if(field.type==='button-choice'){
    const choice=optionForAnswer(field,value,field.options||[]);if(!choice)throw Error('No exact button choice matches the verified answer');await control.getByRole('button',{name:choice,exact:true}).click();
   }else if(field.type==='checkbox'&&field.consentVerified){await control.setChecked(value==='true');
   }else if(field.type==='select'){
    if(await control.evaluate(e=>e.tagName)==='SELECT')await control.selectOption({label:value});
    else{
     const wrapper=tab.page.locator('[class*="select__control"]').filter({has:control});
     if(await wrapper.count()===1)await wrapper.click();else await control.click();
     let options=await tab.page.getByRole('option').allTextContents();
     let choice=optionForAnswer(field,value,options.map(s=>s.trim()));
     if(!choice&&await control.evaluate(e=>e.tagName==='INPUT')){
      await control.fill(field.locationKnown?.city||value);await tab.page.getByRole('option').first().waitFor({state:'visible'});
      options=await tab.page.getByRole('option').allTextContents();choice=optionForAnswer(field,value,options.map(s=>s.trim()));
     }
     if(!choice)throw Error('No exact option matches the verified applicant answer');
     const escaped=choice.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
     await tab.page.getByRole('option').filter({hasText:new RegExp('^\\s*'+escaped+'\\s*$')}).click();
    }
   }else if(['checkbox','manual','radio'].includes(field.type))throw Error('Manual control requires applicant review');
   else await control.fill(value);
  }
  this.lastControl='Resume upload';
  if(!inspection.form.resume.attached){
   const input=this.locator(tab,inspection.form.resume);
   if(await input.count()!==1||await input.getAttribute('type')!=='file')throw Error('Unambiguous resume input unavailable');
   await input.setInputFiles(path.resolve(resume));
   await tab.page.getByText(path.basename(resume),{exact:true}).first().waitFor({state:'visible'});
  }
  this.uploads[inspection.job.id]={filename:path.basename(resume),label:inspection.form.resume.label,sha256:digest(await readFile(resume)),uploadedAt:new Date().toISOString()};
  return {resumeUpload:this.uploads[inspection.job.id]};
 }
 async submit(inspection){
  const page=inspection.tab.page;await page.bringToFront();
  const events=[];this.submissionEvidence={at:new Date().toISOString(),jobId:inspection.job.id,events};
  const record=(request,status)=>{try{const url=new URL(request.url());if(events.length<40&&['POST','PUT'].includes(request.method()))events.push({origin:url.origin,path:url.pathname,method:request.method(),status});}catch{}};
  const response=r=>record(r.request(),r.status()),failed=r=>record(r,'request_failed');page.on('response',response);page.on('requestfailed',failed);
  this.clearSubmissionListeners=()=>{page.off('response',response);page.off('requestfailed',failed)};
  try{await super.submit(inspection);}catch(e){this.clearSubmissionListeners();throw e;}
 }
 async confirm(inspection,options){
  try{const result=await super.confirm(inspection,options);const emailVerificationPending=!result.confirmed&&await inspection.tab.page.evaluate(()=>Array.from({length:8},(_,n)=>document.getElementById('security-input-'+n)).every(e=>e&&e.getClientRects().length>0));return {...result,emailVerificationPending,transportEvidence:this.submissionEvidence?.jobId===inspection.job.id?this.submissionEvidence:undefined};}finally{this.clearSubmissionListeners?.();this.clearSubmissionListeners=null;}
 }
 preservedPage(attempt,{exact=false}={}){
  const matches=p=>{try{return !p.isClosed()&&postingKey(p.url())===postingKey(attempt.url)&&new URL(p.url()).origin===new URL(attempt.url).origin;}catch{return false}};
  const remembered=this.nativeTabs.byId.get(attempt.tabId)?.page;
  if(remembered&&matches(remembered))return remembered;
  if(exact)return null;
  const pages=this.context.pages().filter(matches);
  return pages.length===1?pages[0]:null;
 }
 async recoverReceipt(attempt){
  const page=this.preservedPage(attempt);if(!page)return {confirmed:false,posting:attempt.url};
  const tab=this.nativeTabs.wrap(page);
  return this.confirm({job:{id:attempt.jobId,title:attempt.title,url:attempt.url},tab,tabId:tab.id},{waitMs:0});
 }
 async captureVerificationCheckpoint(inspection){
  if(!['job-boards.greenhouse.io','boards.greenhouse.io'].includes(new URL(inspection.job.url).hostname))return null;
  // The provider rotates this hidden response after Submit. It is not an
  // applicant answer. Visible fields, including similarly named ones, remain
  // in the checkpoint; this never reads, alters or solves the provider widget.
  const fields=await inspection.tab.page.evaluate(()=>[...document.querySelectorAll('input,textarea,select,[aria-pressed],[role="radio"],[role="checkbox"]')].filter(e=>!['hidden','password'].includes(e.type)&&!/^security-input-[0-7]$/.test(e.id)&&e.autocomplete!=='one-time-code'&&!(e.tagName==='TEXTAREA'&&e.name==='g-recaptcha-response'&&/^g-recaptcha-response(?:-\d+)?$/.test(e.id)&&!e.getClientRects().length)).map(e=>({id:e.id,name:e.name,type:e.type||e.getAttribute('role'),value:e.value,checked:['radio','checkbox'].includes(e.type)?e.checked:e.getAttribute('aria-checked'),pressed:e.getAttribute('aria-pressed'),files:e.type==='file'?[...e.files].map(f=>({name:f.name,size:f.size,lastModified:f.lastModified})):undefined,selected:e.closest('[class*="select__control"]')?.querySelector('[class*="single-value"],[class*="singleValue"]')?.textContent||''})));
  return {schema:2,fieldsSha256:digest(fields),resumeSha256:this.uploads[inspection.job.id]?.sha256||null};
 }
 async continueEmailVerification(attempt,code,{beforeActivate}){
  const page=this.preservedPage(attempt,{exact:true});if(!page)throw Error('Original verification page unavailable');
  const tab=this.nativeTabs.byId.get(attempt.tabId),inspection={job:{id:attempt.jobId,title:attempt.title,url:attempt.url},tab,tabId:attempt.tabId};
  const original=attempt.verificationCheckpoint,current=await this.captureVerificationCheckpoint(inspection),upload=this.uploads[attempt.jobId];
  if(original?.schema!==2)throw Error('Legacy checkpoint requires manual verification; it was not replaced');
  if(!current||current.fieldsSha256!==original.fieldsSha256||!upload||current.resumeSha256!==attempt.resumeSha256||upload.sha256!==attempt.resumeSha256||!(await page.locator('body').innerText()).includes(upload.filename))throw Error('Original application changed');
  for(let n=0;n<8;n++){const field=page.locator('#security-input-'+n);if(await field.count()!==1||!await field.isVisible()||await field.getAttribute('maxlength')!=='1')throw Error('Expected email challenge unavailable');}
  for(let n=0;n<8;n++)await page.locator('#security-input-'+n).fill(code[n]);
  for(let n=0;n<8;n++)if(await page.locator('#security-input-'+n).inputValue()!==code[n])throw Error('Verification readback failed');
  if((await this.captureVerificationCheckpoint(inspection)).fieldsSha256!==original.fieldsSha256)throw Error('Application changed during verification');
  const submit=page.getByRole('button',{name:/^submit application$/i});if(await submit.count()!==1||!await submit.isEnabled())throw Error('Verification control unavailable');
  await beforeActivate();await submit.click();const receipt=await this.confirm(inspection);
  const text=receipt.confirmed?'':await page.locator('body').innerText();
  return {receipt,outcome:receipt.confirmed?'confirmed':/invalid security code|security code.*expired/i.test(text)?'invalid-code':'unconfirmed'};
 }
 async close(){this.clearSubmissionListeners?.();await this.context.close();}
}
