// One reviewed employer control. Its public notice makes disclosure optional,
// while the form requires a selection. No applicant answer is encoded here.
const origin='https://job-boards.greenhouse.io/caylent/jobs/6004669004';
export const caylentGenderId='question_17892958004';
export const caylentGenderPurpose='caylent-posting-gender';
export const caylentGenderLabel=`At Caylent, we are dedicated to creating a diverse and inclusive workplace. To support our efforts in fostering a more equitable recruitment process, we invite you to share your gender identity voluntarily. This information is optional and will be kept confidential, used only to help us track and improve our diversity initiatives. If you prefer not to answer, you're welcome to select "Prefer Not to Respond".`;
export const caylentGenderOptions=['Female','Male','Transgender','Non-Binary/Non-Conforming','Other','Prefer Not to Respond'];
const clean=s=>String(s||'').trim().replace(/\s*\*+$/,'').replace(/\s+/g,' ').trim();
const exactOptions=items=>Array.isArray(items) && items.length===caylentGenderOptions.length && items.every((v,i)=>v===caylentGenderOptions[i]);

export function caylentGenderPosting(job) {
  return job?.url===origin && job.source==='greenhouse/caylent' && String(job.sourceId)==='6004669004' &&
    job.company==='Caylent' && job.title==='Senior Forward Deployed Engineer';
}
export function caylentGenderControl(job,field) {
  return caylentGenderPosting(job) && (field.id===caylentGenderId || clean(field.label)===caylentGenderLabel);
}
function wording(field) {
  return field?.id===caylentGenderId && field.required===true && field.type==='select' &&
    clean(field.label)===caylentGenderLabel && !clean(field.description || field.helpText) &&
    !field.policyLinks?.length && exactOptions(field.options);
}
export function caylentGenderQuestion(posting,field,form) {
  return posting?.url===origin && wording(field) && field.caylentGenderVerified===true && form.fields.filter(f=>f.id===field.id).length===1 &&
    form.fields.filter(f=>clean(f.label)===caylentGenderLabel).length===1 && (field.committedChoices||0)<=1;
}

// React Select publishes its menu outside the input. Bind the full live list
// by the control's aria-controls before reading, choosing or disclosing anything.
async function inspectOptions(page,field,chosen) {
  if(page.url()!==origin || !wording(field))return false;
  const form=page.locator('form#application-form'),control=form.locator('[id="'+caylentGenderId+'"]');
  if(await form.count()!==1 || await control.count()!==1)return false;
  const label=form.locator('label[for="'+caylentGenderId+'"]');
  if(await label.count()!==1 || clean(await label.innerText())!==caylentGenderLabel)return false;
  const type=await control.evaluate(e=>e.tagName);
  if(type==='SELECT'){
    const live=await control.evaluate(e=>e.multiple?null:[...e.options].filter(o=>o.value).map(o=>o.textContent.trim()));
    if(!exactOptions(live))return false;
    if(chosen!==undefined)await control.selectOption({label:chosen});
    return true;
  }
  if(await control.getAttribute('role')!=='combobox' || await control.getAttribute('aria-expanded')!=='false')return false;
  const wrapper=form.locator('[class*="select__control"]:has(input[id="'+caylentGenderId+'"])');
  if(await wrapper.count()!==1)return false;
  await wrapper.click();
  try{
    const id=await control.getAttribute('aria-controls');if(!id || !/^[\w:-]+$/.test(id))return false;
    const menu=form.locator('[id="'+id+'"][role="listbox"]');
    if(await menu.count()!==1 || await menu.getAttribute('aria-multiselectable')==='true')return false;
    const options=menu.getByRole('option');await options.first().waitFor({state:'visible',timeout:2500});
    if(!exactOptions((await options.allTextContents()).map(s=>s.trim())))return false;
    if(chosen!==undefined){
      const selected=menu.getByRole('option',{name:chosen,exact:true});if(await selected.count()!==1)return false;
      await selected.click();
    }
    return true;
  } finally {
    if(await control.getAttribute('aria-expanded')==='true')await control.press('Escape');
  }
}
export async function verifyCaylentGender(page,job,form,published) {
  if(!caylentGenderPosting(job))return;
  const candidates=form.fields.filter(f=>f.id===caylentGenderId),source=published?.fields?.filter(f=>f.id===caylentGenderId)||[];
  if(candidates.length!==1 || source.length!==1 || !wording(source[0]) || !wording(candidates[0]))return;
  if(await inspectOptions(page,candidates[0]))candidates[0].caylentGenderVerified=true;
}
export async function fillCaylentGender(page,job,field,answer) {
  if(!caylentGenderControl(job,field) || !field.caylentGenderVerified || !field.caylentGenderAuthorized || !caylentGenderOptions.includes(answer) ||
     !await inspectOptions(page,field,answer))throw Error('Caylent gender question or answer choices changed before entry');
}
