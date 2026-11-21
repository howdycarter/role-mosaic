// This is an offer to the applicant. It is never an answer until that person chooses Allow.
import {cleanField, requestIdentity} from './posting-permission.js';

export function isAshbyRecruitmentNotice(job,field) {
  if (!job?.url || !job.company) return false;
  let url;
  try { url = new URL(job.url); } catch { return false; }
  if (url.origin !== 'https://jobs.ashbyhq.com') return false;
  const employer=job.company;
  const label = cleanField(field.label);
  // Scope the offer to this plain recruitment notice. Additional wording or purposes require review.
  const template = 'By continuing, you acknowledge the following: ' + employer +
    ' will collect and use the personal data you provide to us as an applicant for recruitment-related reasons. ' +
    'For a full description of how this information will be used, shared, and protected, and an explanation of the rights that you have in relation to this information, please see the ' +
    employer + ' Privacy Policy. In addition, you understand that your personal information will be transferred to ' +
    employer + ' non-EEA entities as necessary for the purposes of considering your application for a role.';
  return label === template;
}

function displayedNotice(job, field) {
  const employer = job.company;
  if (typeof employer !== 'string' || !employer.trim() || !field?.id || !field.required ||
      field.type !== 'radio-choice' || field.options?.length !== 1 || field.options[0] !== 'Continue') return null;
  const label = cleanField(field.label);
  if (!isAshbyRecruitmentNotice(job,field) || cleanField(field.description) !== employer + ' Privacy Policy' ||
      field.policyLinks?.length !== 1) return null;
  const link = field.policyLinks[0];
  if (cleanField(link?.text) !== 'Privacy Policy') return null;
  let url;
  try { url = new URL(link.url); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !/^\/(?:legal\/)?privacy(?:-policy)?\/?$/i.test(url.pathname)) return null;
  return {id:field.id,label,type:field.type,answer:field.options[0],kind:'recruitment-privacy',
    help:cleanField(field.description),links:[link.url],options:[...field.options]};
}

export function ashbyRecruitmentPermission({job,posting,form,missing,profileSha256}) {
  if (!posting?.board.startsWith('jobs.ashbyhq.com/') || !Array.isArray(form?.fields) || !profileSha256) return null;
  const fields = form.fields.map(field => displayedNotice(job,field)).filter(Boolean);
  if (fields.length !== 1 || !missing.some(label => cleanField(label) === fields[0].label)) return null;
  const record = fields[0];
  if (form.fields.filter(f => f.id === record.id).length !== 1 ||
      form.fields.filter(f => cleanField(f.label) === record.label).length !== 1 ||
      form.fields.find(f => f.id === record.id).value) return null;
  return {id:requestIdentity(job,posting,profileSha256,fields),purpose:'recruitment-privacy',fields};
}

export function ashbyRecruitmentPermissionMatches({job,posting,form,permission}) {
  if (!posting?.board.startsWith('jobs.ashbyhq.com/') || permission.fields?.length !== 1) return false;
  const record = permission.fields[0];
  if (record.kind !== 'recruitment-privacy') return false;
  const matches = form.fields.filter(field => field.id === record.id || cleanField(field.label) === record.label);
  if (matches.length !== 1) return false;
  const observed = displayedNotice(job,matches[0]);
  return observed !== null && (!matches[0].value || matches[0].value === observed.answer) &&
    requestIdentity(job,posting,permission.profileSha256,[observed]) === permission.requestId;
}
