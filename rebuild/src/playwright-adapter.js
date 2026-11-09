import path from 'node:path';
import {mkdir,chmod,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CodexBrowserAdapter} from './browser-adapter.js';
import {digest,postingKey,supportedPosting} from './applications.js';
import {optionForAnswer,sameAnswer} from './application-values.js';

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
 constructor(context,{home}={}){const tabs=new NativeTabs(context);super({tabs},{home});this.context=context;this.nativeTabs=tabs;this.transport='playwright';}
 static async launch({home,headless=false,channel='chrome',context}={}){
  if(!context){
   const directory=path.join(home,'browser-profile');await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
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
  let overview=await tab.page.locator('body').innerText();
  if(new URL(job.url).hostname==='jobs.ashbyhq.com'){
   const application=tab.page.getByRole('tab',{name:'Application',exact:true});
   if(await application.count()===1&&await application.getAttribute('aria-selected')!=='true')await application.click();
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
  const unsupported=await tab.page.evaluate(()=>{
   const visible=e=>e.getClientRects().length>0&&e.getBoundingClientRect().width>1&&getComputedStyle(e).visibility!=='hidden';
   const controls=[...document.querySelectorAll('input[type="radio"], [role="radiogroup"],button[role="combobox"], [role="checkbox"]')].filter(visible);
   const labels=controls.map(e=>e.getAttribute('aria-label')||e.closest('fieldset')?.querySelector('legend')?.innerText||e.closest('[class*="field"],[class*="question"]')?.innerText||'Unsupported custom application control');
   // Unlabelled visible inputs cannot safely disappear from required checks.
   return [...new Set(labels)];
  });
  for(const label of unsupported)inspection.form.fields.push({id:'',label:'Manual control: '+label.slice(0,240),type:'manual',required:true,value:''});
  return inspection;
 }
 locator(tab,field){
  if(field.id)return tab.page.locator('[id='+JSON.stringify(field.id)+']');
  return tab.page.getByLabel(field.label.replace(/\*$/,'').trim(),{exact:true});
 }
 async fill(inspection,actions,resume){
  const tab=inspection.tab;
  for(const {field,value} of actions){
   this.lastControl=field.label;
   if(field.value&&sameAnswer(field,field.value,value))continue;
   const control=this.locator(tab,field);
   if(field.type==='select'){
    if(await control.evaluate(e=>e.tagName)==='SELECT')await control.selectOption({label:value});
    else{
     await control.click();
     let options=await tab.page.getByRole('option').allTextContents();
     let choice=optionForAnswer(field,value,options.map(s=>s.trim()));
     if(!choice&&await control.evaluate(e=>e.tagName==='INPUT')){
      await control.fill(value);await tab.page.getByRole('option').first().waitFor({state:'visible'});
      options=await tab.page.getByRole('option').allTextContents();choice=optionForAnswer(field,value,options.map(s=>s.trim()));
     }
     if(!choice)throw Error('No exact option matches the verified applicant answer');
     await tab.page.getByRole('option',{name:choice,exact:true}).click();
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
 async close(){await this.context.close();}
}
