// This workflow covers the reviewed US MongoDB survey on its verified Greenhouse embed.
import {digest} from './applications.js';
import {mongoEmbedRoute} from './greenhouse-embed.js';
import {cleanField,requestIdentity} from './posting-permission.js';

const heading='U.S. Voluntary Demographic Survey';
const consent='By checking this box, I consent to MongoDB collecting, storing, and processing my responses to the demographic data surveys above.';
const labels=['Gender','Gender Identity','Race','Are you Hispanic/Latino?','Veteran Status','Disability Status'];
const declineLabel="I don't wish to answer";
const consentId='gdpr_demographic_data_consent_given_1';

export function publishedMongoSurvey(raw) {
  if(raw?.header!==heading || typeof raw.description!=='string' || !Array.isArray(raw.questions) ||
    raw.questions.length!==labels.length || !raw.description || raw.description.length>16000) return null;
  // Only this employer's text markup is parsed in a detached document. No resource-bearing elements.
  if([...raw.description.matchAll(/<\/?\s*([\w:-]+)/g)].some(([,tag])=>!['p','strong','a','br','em','b'].includes(tag.toLowerCase()))) return null;
  const questions=[];
  for(const row of raw.questions){
    if(!labels.includes(row.label) || !Number.isSafeInteger(row.id) || row.id<=0 || row.required!==true ||
      row.type!=='multi_value_single_select' || !Array.isArray(row.answer_options)) return null;
    const options=row.answer_options.map(o=>o?.label);
    const flagged=row.answer_options.filter(o=>o?.decline_to_answer===true);
    if(options.length<2 || options.some(o=>typeof o!=='string'||!o.trim()) || new Set(options).size!==options.length ||
      flagged.length!==1 || flagged[0].label!==declineLabel || flagged[0].free_form!==false) return null;
    questions.push({id:String(row.id),label:row.label,options});
  }
  if(new Set(questions.map(q=>q.id)).size!==labels.length || new Set(questions.map(q=>q.label)).size!==labels.length)return null;
  return {heading,description:raw.description,questions,consentId,consent,declineLabel};
}

// Executed inside the verified embedded application. Return only wording and controls.
// The checkbox and additional privacy copy can be hydrated outside the demographic section.
export function observeMongoSurvey(published) {
  const form=document.querySelector('form#application-form');
  const sections=form?.querySelectorAll('#demographic-section');
  if(sections?.length!==1)return null;
  const section=sections[0], caption=section.querySelector(':scope > h3'),body=section.querySelector(':scope > .body');
  const checkbox=form.querySelector('#'+published.consentId), submit=form.querySelector('button[type=submit]');
  const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
  const label=n=>clean(n.labels?.[0]?.innerText).replace(/\s*\*$/,'').trim();
  const visible=n=>n?.getClientRects().length>0 && getComputedStyle(n).visibility!=='hidden';
  if(!visible(caption)||clean(caption.innerText)!==published.heading || !visible(body) || !visible(checkbox) ||
    checkbox.type!=='checkbox' || !submit || label(checkbox)!==published.consent || section.contains(checkbox) ||
    !(section.compareDocumentPosition(checkbox)&Node.DOCUMENT_POSITION_FOLLOWING) ||
    !(checkbox.compareDocumentPosition(submit)&Node.DOCUMENT_POSITION_FOLLOWING))return null;
  const controls=[...section.querySelectorAll('input,select,textarea,[role=checkbox],[role=radiogroup]')]
    .filter(e=>!e.matches('input[type=hidden],[aria-hidden=true]') && visible(e));
  if(controls.length!==published.questions.length ||
     !published.questions.every(q=>controls.filter(n=>n.id===q.id && label(n)===q.label &&
       (n.matches('input[role=combobox]')||n.matches('select:not([multiple])'))).length===1))return null;
  const expected=new DOMParser().parseFromString(published.description,'text/html').body;
  const textKey=str=>str.replace(/\s/g,'');
  if(textKey(expected.textContent)!==textKey(body.innerText))return null;
  const urls=node=>[...node.querySelectorAll('a[href]')].map(a=>a.href);
  const publicLinks=urls(expected),noticeLinks=urls(body);
  if(!noticeLinks.includes('https://www.mongodb.com/legal/eu-ca-recruitment-privacy-notice') ||
    JSON.stringify(noticeLinks)!==JSON.stringify(publicLinks))return null;
  const tail=document.createRange();tail.setStartAfter(section);tail.setEndBefore(submit);
  const walker=document.createTreeWalker(form,NodeFilter.SHOW_TEXT);
  const terms=[];
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(tail.intersectsNode(node) && visible(node.parentElement) && !node.parentElement.closest('script,style,noscript'))terms.push(node.textContent);
  }
  const extraLinks=[...form.querySelectorAll('a[href]')].filter(a=>tail.intersectsNode(a)).map(a=>a.href);
  const links=[...new Set([...noticeLinks,...extraLinks])];
  if(links.some(href=>{try{const url=new URL(href);return url.protocol!=='https:'||url.username||url.password;}catch{return true;}}))return null;
  return {heading:published.heading,description:body.innerText.trim(),terms:clean(terms.join(' ')),links,
    questions:published.questions,consentId:published.consentId,consent:published.consent,declineLabel:published.declineLabel};
}

// Bind each option set to its actual control. A prior selection must never be overwritten.
export function attachMongoSurvey(form,survey) {
  if(!survey)return;
  const inputs=survey.questions.map(q=>form.fields.find(f=>f.id===q.id));
  const consentField=form.fields.find(f=>f.id===survey.consentId);
  const all=[...inputs,consentField];
  if(all.some(f=>!f || !f.required || form.fields.filter(other=>other.id===f.id || cleanField(other.label)===cleanField(f.label)).length!==1))return;
  if(consentField.type!=='checkbox'||cleanField(consentField.label)!==survey.consent || !survey.terms.includes(survey.consent))return;
  if(inputs.some((f,i)=>f.type!=='select'||cleanField(f.label)!==survey.questions[i].label ||
    (f.options?.length && digest(f.options.filter(Boolean))!==digest(survey.questions[i].options))))return;
  inputs.forEach((f,i)=>{f.options=survey.questions[i].options;});
  form.voluntarySurvey=survey;
}

function recordsFor(form,unfilled) {
  const survey=form.voluntarySurvey;
  if(!survey)return null;
  const fields=[];
  for(const q of [...survey.questions,{id:survey.consentId,label:survey.consent}]){
    const f=form.fields.find(field=>field.id===q.id);
    if(!f || cleanField(f.label)!==q.label || !f.required ||
       form.fields.filter(other=>other.id===q.id || cleanField(other.label)===q.label).length!==1)return null;
    const checkbox=q.id===survey.consentId, answer=checkbox?'true':survey.declineLabel;
    if(checkbox ? f.type!=='checkbox' : f.type!=='select' || digest(f.options)!==digest(q.options) || !q.options.includes(answer))return null;
    const value=String(f.value??'').trim();
    if(checkbox ? value!=='false' && (unfilled || value!=='true') :
       (f.committedChoices>1 || (value && (unfilled || value!==answer)) || (f.committedChoices>0 && !value)))return null;
    const help=checkbox?[survey.heading,survey.description,survey.terms,f.description].filter(Boolean).join('\n\n'):cleanField(f.description);
    const links=[...new Set([...(checkbox?survey.links:[]),...(f.policyLinks||[])])];
    fields.push({id:f.id,label:q.label,type:f.type,answer,kind:checkbox?'privacy-consent':'survey-decline',
      help,links,options:f.options||[]});
  }
  return fields;
}

export function voluntarySurveyProposal({job,posting,form,missing,profile}) {
  if(!profile?.verified || posting.board!=='mongodb' || mongoEmbedRoute(job.url)?.key!==posting.key)return null;
  const fields=recordsFor(form,true), missingLabels=new Set(missing.map(cleanField));
  if(!fields || !fields.every(f=>missingLabels.has(f.label)))return null;
  // A configured demographic response belongs in the applicant's own choices. Never replace it with a default.
  if(Object.entries(profile.facts||{}).some(([name,value])=>value!==undefined && value!==null && value!=='' &&
    /race|racial|ethnic|gender|hispanic|latino|veteran|disabil|sexualOrientation/i.test(name)))return null;
  if(profile.answers?.some(a=>a.verified && (!a.scopePostingKey || a.scopePostingKey==='greenhouse:'+posting.id) &&
    fields.some(f=>f.label===cleanField(a.question))))return null;
  return {purpose:'decline-voluntary-survey',id:requestIdentity(job,posting,digest(profile),fields),fields};
}

export function voluntarySurveyMatches(permission,form) {
  const fields=recordsFor(form,false);
  return Boolean(fields && digest(fields)===digest(permission.fields));
}

// A live form can change after its preflight. Recheck the legal wording and the
// selected value before writing any of the seven choices authorized together.
export async function fillVoluntarySurveyField(page,control,{published,survey,field,value}) {
  async function verify() {
    if(!published || !survey || digest(await page.evaluate(observeMongoSurvey,published))!==digest(survey))
      throw Error('Voluntary survey or consent changed before entry');
  }
  await verify();
  if(field.id===survey.consentId) {
    if(field.type!=='checkbox'||!field.consentVerified||value!=='true')throw Error('Survey consent requires the reviewed checkbox');
    if(!await control.isChecked())await control.check();
    return;
  }
  const question=survey.questions.find(q=>q.id===field.id);
  if(!question||field.type!=='select'||value!==survey.declineLabel)throw Error('Survey choice differs from the approved decline option');
  const selected=await control.evaluate(e=>{
    if(e.tagName==='SELECT')return [...e.selectedOptions].filter(o=>o.value).map(o=>o.textContent.trim());
    const widget=e.closest('[class*="select__control"]');
    if(!widget)return null;
    return [...widget.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"],[class*="multiValueLabel"]')]
      .map(n=>n.textContent.trim());
  });
  if(!selected || selected.length>1 || (selected.length && selected[0]!==value))throw Error('Existing voluntary survey answer requires review');
  if(selected.length)return;
  if(await control.evaluate(e=>e.tagName==='SELECT')){
    const options=await control.evaluate(e=>[...e.options].filter(o=>o.value).map(o=>o.textContent.trim()));
    if(digest(options)!==digest(question.options))throw Error('Voluntary survey options changed');
    await control.selectOption({label:value});return;
  }
  const widget=page.locator('[class*="select__control"]').filter({has:control});
  if(await widget.count()!==1)throw Error('Voluntary survey selector changed');
  await widget.click();
  const menuId=await control.getAttribute('aria-controls');
  if(!menuId || /\s/.test(menuId))throw Error('Voluntary survey options could not be bound to their selector');
  const menu=page.locator('form#application-form [role=listbox][id='+JSON.stringify(menuId)+']');
  if(await menu.count()!==1)throw Error('Voluntary survey option list changed');
  const options=menu.getByRole('option');
  await options.first().waitFor({state:'visible'});
  if(digest((await options.allTextContents()).map(t=>t.trim()))!==digest(question.options))throw Error('Voluntary survey options changed');
  await verify();
  await menu.getByRole('option',{name:value,exact:true}).click();
}
