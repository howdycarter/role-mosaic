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

export function permissionProposal({job,form,missing,profile,posting,priorPostings}) {
 if(!posting || posting.postingOnly || !profile?.verified || !form?.fields?.length) return null;
 const labels = new Set(missing.map(cleanField));
 const fields = [];
 for(const field of form.fields) {
  const label = cleanField(field.label);
  if(!labels.has(label) && (field.required || field.type !== 'checkbox'))continue;
  if(form.fields.filter(f=>cleanField(f.label)===label).length!==1)continue;
  const records=(profile.answers||[]).filter(a=>a.verified===true && priorPostings.has(a.scopePostingKey) &&
   cleanField(a.question)===label && typeof a.answer==='string' && a.answer && eligible(field,a));
  if(!records.length || new Set(records.map(a=>JSON.stringify([a.answer,a.kind]))).size!==1)continue;
  const {answer,kind}=records[0];
  if(field.type==='select' && field.options?.length && !field.options.includes(answer))continue;
  fields.push({id:field.id,label,type:field.type,answer,...(kind?{kind}:{}),
   help:cleanField(field.description),links:field.policyLinks||[],options:field.options||[]});
 }
 if(!fields.some(f=>labels.has(f.label)))return null;
 const id=digest([job.id,posting.key,job.title,digest(profile),fields]);
 return {id,fields};
}
