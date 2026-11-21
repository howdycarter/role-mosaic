import {caylentGenderControl} from './caylent-gender.js';
// A fresh posting can propose previously verified answers from this employer.
// Only the applicant can authorize the exact displayed disclosure and recipient.
import {digest} from './applications.js';

export const cleanField = value => String(value ?? '').replace(/\s+/g,' ').replace(/\s*\*+\s*$/,'').trim();
const demographic = /\b(?:ethnicit(?:y|ies)|gender identity|transgender|sexual orientation|disability|veteran)\b/i;
const prohibited = /\b(?:arbitrat\w*|waiv\w*|liability|background check|attest\w*|criminal|terms of (?:service|use)|signature|certif\w*|payment)\b/i;

function eligible(field, record) {
 const wording = cleanField(field.label);
 if(!wording || !field.id || prohibited.test(wording+' '+(field.description||''))) return false;
 if(record.kind === 'privacy-consent'){
  return (field.type === 'select' || field.type === 'checkbox' && record.answer === 'true') &&
   /(?:candidate|applicant) privacy (?:notice|policy)|(?:demographic data|demographic (?:survey|responses))/i.test(wording);
 }
 return field.type === 'select' && demographic.test(wording) && !record.kind;
}

function displayedField(field,record) {
 const {answer,kind}=record;
 return {id:field.id,label:cleanField(field.label),type:field.type,answer,...(kind?{kind}:{}),
  help:cleanField(field.description),links:field.policyLinks||[],options:field.options||[]};
}

export function requestIdentity(job,posting,profileSha256,fields) {
 return digest([job.id,posting.key,job.title,profileSha256,fields]);
}

// Check both the data authorized and the individual controls that will receive it.
// Unfilled controls can still be prepared; nonempty survey selections must already
// agree exactly, including every selected item in a multi-select.
export function matchesPermissionFields(permission,form,{legacyHelp=false,requireUnfilled=false}={}) {
 if(!Array.isArray(permission.fields) || !permission.fields.length)return false;
 return permission.fields.every(record=>{
  const matches=form.fields.filter(f=>f.id===record.id);
  if(matches.length!==1 || form.fields.filter(f=>cleanField(f.label)===record.label).length!==1)return false;
  const field=matches[0];
  if(!eligible(field,record))return false;
  const description=legacyHelp ? (field.legacyDescription ?? field.description) : field.description;
  const observed=displayedField({...field,description},record);
  if(digest(observed)!==digest(record))return false;
  const value=String(field.value??'').trim();
  if(field.type==='checkbox')return !requireUnfilled || !value || value==='false';
  return !value || (!requireUnfilled && value===record.answer);
 });
}

export function permissionProposal({job,form,missing,profile,posting,priorPostings}) {
 if(!posting || posting.postingOnly || !profile?.verified || !form?.fields?.length) return null;
 const labels = new Set(missing.map(cleanField));
 const fields = [];
 for(const field of form.fields) {
  if(caylentGenderControl(job,field))continue;
  const label = cleanField(field.label);
  if(!labels.has(label) && (field.required || field.type !== 'checkbox'))continue;
  if(form.fields.filter(f=>cleanField(f.label)===label).length!==1)continue;
  const records=(profile.answers||[]).filter(a=>a.verified===true && priorPostings.has(a.scopePostingKey) &&
   cleanField(a.question)===label && typeof a.answer==='string' && a.answer && eligible(field,a));
  if(!records.length || new Set(records.map(a=>JSON.stringify([a.answer,a.kind]))).size!==1)continue;
  const {answer,kind}=records[0];
  if(field.type==='select' && field.options?.length && !field.options.includes(answer))continue;
  fields.push(displayedField(field,{answer,kind}));
 }
 if(!fields.some(f=>labels.has(f.label)))return null;
 const id=requestIdentity(job,posting,digest(profile),fields);
 return {id,fields};
}
