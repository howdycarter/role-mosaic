import {caylentGenderPurpose,caylentGenderQuestion} from './caylent-gender.js';
// Private, local grants for questions actually observed on a Greenhouse form.
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { digest } from './applications.js';
import {voluntarySurveyMatches,voluntarySurveyProposal} from './mongo-voluntary-survey.js';
import { mongoEmbedRoute } from './greenhouse-embed.js';
import {ashbyRecruitmentPermission, ashbyRecruitmentPermissionMatches} from './ashby-recruitment-privacy.js';
import {cleanField, matchesPermissionFields, permissionProposal, requestIdentity} from './posting-permission.js';

const filename = 'greenhouse-inbox.json';
const emptyState = () => ({ version: 1, observations: [], grants: [] });
const hosts = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);
const supported = new Set(['text', 'textarea', 'number', 'select', 'email', 'tel', 'url']);
const nativeChoices = new Set(['button-choice', 'radio-choice']);
const acknowledgment = /\b(?:acknowledg\w*|authoriz(?:e|es|ing)|permission|release of (?:information|claims)|waiv\w*|opt[- ](?:in|out)|I (?:accept|decline|understand|permit|grant)|(?:may|can|could) we (?:record|contact|store|process|share|retain|disclose)|privacy policy|terms and conditions)\b/i;
const permissionOption = /^(?:accept|decline|allow|deny|agree|disagree|I do not agree)$/i;
const scopes = ['posting', 'employer', 'future'];

// Cross-employer reuse is opt-in and limited to an exact, single-purpose
// question. A question's wording, choices, control type and help must match.
const portable = /^(?:(?:what is your |your )?(?:notice period|preferred name)|when (?:can|could) you start|when are you (?:available|free) to start|(?:which|what) languages (?:do you speak fluently|are you fluent in)|portfolio (?:url|website|link)|(?:your )?linkedin (?:profile|url|profile url))\??$/i;
const employerHistory = /^(?:have you (?:ever |previously )?(?:worked (?:for|at)|been employed (?:by|at)) .+?|are you (?:currently )?employed (?:by|at) .+?)\??$/i;
const manual = /\b(?:captcha|recaptcha|password|passphrase|passcode|otp|token|pin code|verification code|security code|authentication code|social security|ssn|tax identification|national id|passport|driver.s licen[cs]e number|bank account|routing number|credit card|debit card|signature|sign electronically|attest|attestation|consent|certify|arbitration|agree|agreement|terms of (?:use|service)|authorization to|background check|criminal|disability|disabled|veteran|racial|race|ethnic(?:ity|ities)?|(?:candidate|applicant) privacy (?:notice|policy)|hispanic|gender|transgender|sexual orientation|religion|medical history|human verification|human check|verification challenge|not a robot|api key|secret key|security question|recovery code|backup code|cryptographic key)\b|type (?:your|my) (?:full |legal )?name|one[- ]time (?:code|password)|verify (?:that )?you are human/i;
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export function greenhousePosting(raw) {
  try {
    const embed = mongoEmbedRoute(raw);
    if (embed) return embed;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password) return null;
    const match = /^\/([a-z0-9_-]+)\/jobs\/(\d+)(?:\/(application|confirmation))?\/?$/i.exec(url.pathname);
    const queryIds = url.searchParams.getAll('gh_jid');
    if (!match || queryIds.some(id => id !== match[2])) return null;
    return { board: match[1], id: match[2], confirmation: match[3]?.toLowerCase() === 'confirmation', key: match[1] + '/' + match[2], url: url.origin + '/' + match[1] + '/jobs/' + match[2] };
  } catch { return null; }
}

export function applicationPosting(raw) {
  const posting = greenhousePosting(raw);
  if (posting) return posting.confirmation ? null : posting;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    const route = /^\/([a-z0-9_-]+)\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(?:\/(apply|application))?\/?$/i.exec(url.pathname);
    const suffix = {'jobs.ashbyhq.com':'application','jobs.lever.co':'apply'}[url.hostname];
    if (!route || !suffix || route[3] && route[3] !== suffix) return null;
    const board = url.hostname + '/' + route[1], id = route[2].toLowerCase();
    return {board, id, key:board+'/'+id, url:url.origin+'/'+route[1]+'/'+id, postingOnly:true};
  } catch { return null; }
}

function question(field, form, posting) {
  if (!field?.required) return null;
  const nativeChoice = nativeChoices.has(field.type);
  if (nativeChoice ? !posting.board.startsWith('jobs.ashbyhq.com/') || !field.id : !supported.has(field.type)) return null;
  const label = normalize(field.label).replace(/\s*\*+$/, '').trim();
  const help = normalize(field.description || field.helpText || '');
  if(caylentGenderQuestion(posting,field,form)){
    const purpose=caylentGenderPurpose;
    return {key:digest([purpose,label,field.id,field.options]),label,type:'select',options:field.options,scopes:['posting'],purpose};
  }
  if (!label || label.length > 500 || help.length > 1200 || manual.test(label + ' ' + help)) return null;
  if (!Array.isArray(form?.fields) || form.fields.filter(f => normalize(f.label).replace(/\s*\*+$/, '').trim() === label).length !== 1) return null;
  let options = [];
  if (field.type === 'select' || nativeChoice) {
    if (!Array.isArray(field.options) || field.options.length > 300 || field.options.some(x => typeof x !== 'string' || x.length > 400)) return null;
    options = field.options.filter(x => x.trim() && !/^select(?: an? option)?[.…]*$/i.test(x.trim()));
    if (options.length === 0 || new Set(options.map(x => normalize(x).toLowerCase())).size !== options.length) return null;
    if (nativeChoice && (field.policyLinks?.length || acknowledgment.test(label+' '+help) ||
        options.some(option => manual.test(option) || acknowledgment.test(option) || permissionOption.test(option.trim())))) return null;
  }
  const key = digest([label, help, field.type, options, true]);
  const wording = label;
  let allowed = ['posting'];
  if (!help && portable.test(wording)) allowed = scopes;
  else if (!help && employerHistory.test(wording) && !/\b(?:and|or|this (?:role|position)|if so|if yes)\b/i.test(wording)) allowed = ['posting', 'employer'];
  return { key, label, type: field.type, options, scopes: posting.postingOnly ? ['posting'] : allowed, ...(help ? { help } : {}) };
}

export function formStamp(job, form, {legacyHelp=false}={}) {
  return digest([job.title, form.fields.map(f => [f.id || '', f.type, normalize(f.label),
    normalize((legacyHelp ? f.legacyDescription ?? f.description : f.description) || f.helpText),
    !!f.required, Array.isArray(f.options) ? f.options : [], ...(f.policyLinks?.length ? [f.policyLinks] : [])]), ...(form.voluntarySurvey ? [form.voluntarySurvey] : [])]);
}

function validValue(q, value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
  if (q.type === 'select' || nativeChoices.has(q.type)) return q.options.includes(value);
  if (q.type === 'number') return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value));
  if (q.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (q.type === 'url') {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }
  return true;
}

function target(scope, observation) {
  if (scope === 'posting') return observation.key + ':' + observation.stamp;
  if (scope === 'employer') return observation.board;
  return '*';
}

function grantFor(state, observation, q) {
  // More specific authorizations take precedence over a general one.
  for (const scope of q.scopes) {
    const match = state.grants.find(g => g.scope === scope && g.profileSha256 === observation.profileSha256 &&
      g.questionKey === q.key && g.target === target(scope, observation) && validValue(q, g.answer));
    if (match) return match;
  }
  return null;
}

// A short filesystem ticket lock covers only inbox read/modify/write. Unique
// ticket names let a later process discard a dead writer without unlinking a
// newer owner's lock. A choosing marker closes the race between two issuers.
async function withInboxLock(store, work) {
  const directory = path.join(store.root, 'greenhouse-inbox-writers');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const owner = process.pid + '-' + randomUUID();
  let ownFile = 'choosing-' + owner;
  await writeFile(path.join(directory, ownFile), '', { flag: 'wx', mode: 0o600 });
  try {
    const files = await readdir(directory);
    const highest = files.reduce((max, file) => {
      const ticket = /^(\d{16})-/.exec(file);
      return ticket ? Math.max(max, Number(ticket[1])) : max;
    }, 0);
    const ticket = String(highest + 1).padStart(16, '0') + '-' + owner;
    await rename(path.join(directory, ownFile), path.join(directory, ticket));
    ownFile = ticket;
    const deadline = performance.now() + 3000;
    for (;;) {
      let blocked = false;
      for (const other of await readdir(directory)) {
        if (!other.startsWith('choosing-') && other >= ticket) continue;
        const match = /^(?:choosing|\d{16})-(\d+)-[a-f0-9-]{36}$/.exec(other);
        if (!match) continue;
        try {
          process.kill(Number(match[1]), 0);
          blocked = true;
        } catch (e) {
          if (e.code === 'ESRCH') await rm(path.join(directory, other), { force: true });
          else if (e.code === 'EPERM') blocked = true;
          else throw e;
        }
      }
      if (!blocked) return await work();
      if (performance.now() >= deadline) throw Error('Another Greenhouse inbox update is busy. Retry shortly.');
      await delay(20);
    }
  } finally {
    await rm(path.join(directory, ownFile), { force: true });
  }
}

export async function readGreenhouseAnswers(store) {
  const state = await store.read(filename, emptyState());
  if (state?.version !== 1 || !Array.isArray(state.observations) || !Array.isArray(state.grants)) throw Error('Unrecognized private Greenhouse inbox format');
  return state;
}

export function greenhouseAnswerFor(state, { job, field, form, profileSha256 }) {
  const posting = applicationPosting(job?.url);
  if (!posting || !state?.grants?.length) return undefined;
  const q = question(field, form, posting);
  if (!q) return undefined;
  return grantFor(state, { ...posting, profileSha256, stamp: formStamp(job, form) }, q)?.answer;
}

function allowedForPosting(state,{job,profileSha256},posting) {
  if(!posting || posting.confirmation || !state.permissions?.length ||
     state.permissions.some(p=>p.postingKey===posting.key && p.decision==='skip'))return [];
  return state.permissions.filter(p=>p.jobId===job.id && p.postingKey===posting.key &&
    p.profileSha256===profileSha256 && p.decision==='allow' && p.title===job.title &&
    Array.isArray(p.fields) && requestIdentity(job,posting,profileSha256,p.fields)===p.requestId);
}

export function approvedPostingPermission(state,{job,form,profileSha256}) {
  const posting=applicationPosting(job.url);
  const grants=allowedForPosting(state,{job,profileSha256},posting);
  if(!grants.length)return null;
  const stamp=formStamp(job,form);
  for(const permission of grants.slice().reverse()){
    if(posting.postingOnly) {
      if(permission.stamp===stamp && ashbyRecruitmentPermissionMatches({job,posting,form,permission}))return permission;
      continue;
    }
    if(permission.fields.some(f=>f.kind==='survey-decline')) {
      if(posting.board==='mongodb' && mongoEmbedRoute(job.url)?.key===posting.key && permission.stamp===stamp && voluntarySurveyMatches(permission,form))return permission;
      continue;
    }
    if(permission.binding) {
      if(permission.binding.sourceStamp!==permission.stamp || permission.binding.stableStamp!==stamp)continue;
      const current={...permission,fields:permission.binding.fields};
      if(requestIdentity(job,posting,profileSha256,current.fields)!==permission.binding.stableRequestId)continue;
      if(matchesPermissionFields(current,form))return current;
    }else if(permission.stamp===stamp && matchesPermissionFields(permission,form))return permission;
  }
  return null;
}

// Transfer a legacy form revision only from one inspection that reproduces its
// original hash, including the formerly captured transient descriptions. Never
// strip strings such as "Select..." from a saved employer policy.
export async function bindObservedPostingPermission({store,job,form,profileSha256}) {
  return withInboxLock(store,async()=>{
    if(await activeProfileHash(store)!==profileSha256)return null;
    const state=await readGreenhouseAnswers(store),posting=greenhousePosting(job.url);
    const inputs={job,form,profileSha256},current=approvedPostingPermission(state,inputs);
    if(current)return current;
    const legacyStamp=formStamp(job,form,{legacyHelp:true});
    const previous=allowedForPosting(state,inputs,posting).find(p=>!p.binding && !p.fields.some(f=>f.kind==='survey-decline') && p.stamp===legacyStamp &&
      matchesPermissionFields(p,form,{legacyHelp:true,requireUnfilled:true}));
    if(!previous)return null;
    const proposal=await proposedPermission(store,job,form,previous.fields.map(f=>f.label),posting);
    if(!proposal || !sameAuthorizedAnswers(previous.fields,proposal.fields))return null;
    previous.binding={sourceStamp:legacyStamp,stableStamp:formStamp(job,form),stableRequestId:proposal.id,
      fields:proposal.fields,verifiedAt:new Date().toISOString()};
    await store.write(filename,state);
    return approvedPostingPermission(state,inputs);
  });
}

function sameAuthorizedAnswers(before,after) {
  const material=fields=>fields.map(({id,label,type,answer,kind,links,options})=>
    [id,label,type,answer,kind||'',links,options]);
  return digest(material(before))===digest(material(after));
}

async function proposedPermission(store,job,form,missing,posting) {
  if (!form || !missing.length) return null;
  const profile=await store.read('application-profile.json',null);
  if (posting.postingOnly) return profile?.verified ? ashbyRecruitmentPermission({job,posting,form,missing,profileSha256:digest(profile)}) : null;
  const survey=async()=>{
    const candidate=voluntarySurveyProposal({job,posting,form,missing,profile});
    if(!candidate)return null;
    const previous=(await readGreenhouseAnswers(store)).permissions||[];
    const changed=previous.some(p=>p.postingKey===posting.key && p.profileSha256===digest(profile) &&
      (p.decision!=='allow' || p.requestId!==candidate.id || p.stamp!==formStamp(job,form)));
    return changed?null:candidate;
  };
  if(!profile?.answers?.some(a=>a.verified && a.scopePostingKey && missing.some(label=>cleanField(label)===cleanField(a.question))))return survey();
  const ledger=await store.read('application-ledger.json',[]);
  const priorPostings=new Set(ledger.flatMap(row=>{
    const previous=greenhousePosting(row.url);
    return previous?.board===posting.board && previous.id!==posting.id ? ['greenhouse:'+previous.id] : [];
  }));
  return permissionProposal({job,form,missing,profile,posting,priorPostings}) || survey();
}

export async function decidePostingPermission({store,id,jobId,revision,decision}) {
  if(!['allow','skip'].includes(decision))throw Error('Choose whether to authorize these answers for this posting.');
  return withInboxLock(store,async()=>{
    const state=await readGreenhouseAnswers(store), profileSha256=await activeProfileHash(store);
    const live=await liveObservations(store,state,profileSha256);
    const o=live.find(o=>o.channel==='worker' && o.jobId===jobId && o.stamp===revision && o.proposal?.id===id);
    if(!o && decision==='skip'){
      const personal=live.find(row=>row.channel==='worker' && row.jobId===jobId && row.stamp===revision &&
        row.questions.some(q=>q.purpose===caylentGenderPurpose && groupId(state,row,q)===id));
      if(personal){
        (state.permissions??=[]).push({id:randomUUID(),requestId:id,decision,postingKey:personal.key,jobId,stamp:revision,profileSha256,
          fields:[],company:personal.company,title:personal.title,confirmedAt:new Date().toISOString()});
        await store.write(filename,state);return {jobIds:[]};
      }
    }
    if(!o)throw Error('This form or permission request changed. Refresh your inbox.');
    state.permissions??=[];
    const prior=state.permissions.find(p=>p.requestId===id && p.stamp===revision);
    if(prior && prior.decision!==decision)throw Error('This permission has already been answered.');
    if(!prior) {
      state.permissions.push({id:randomUUID(),requestId:id,decision,postingKey:o.key,jobId,stamp:revision,profileSha256,
        fields:o.proposal.fields,company:o.company,title:o.title,confirmedAt:new Date().toISOString()});
      await store.write(filename,state);
    }
    return {jobIds:decision==='allow' && !o.otherBlockers && o.questions.every(q=>grantFor(state,o,q))?[jobId]:[]};
  });
}

export async function observeGreenhouseQuestions({ store, job, form, missing, profileSha256, channel = 'worker' }) {
  const posting = applicationPosting(job?.url);
  if (!posting || !job.id || !Array.isArray(missing) || !['worker', 'manual'].includes(channel)) return;
  const labels = new Set(missing);
  const proposal = channel==='worker' ? await proposedPermission(store,job,form,missing,posting) : null;
  const proposedLabels=new Set(proposal?.fields.map(f=>f.label));
  const questions = (form?.fields || []).filter(field => labels.has(field.label) && !proposedLabels.has(cleanField(field.label)))
    .map(field => question(field, form, posting)).filter(Boolean);
  // An unsupported control is never answered by inventing a value. It can
  // still independently hold a posting after the answerable items are saved.
  const covered = new Set([...questions,...(proposal?.fields||[])].map(q=>q.label));
  const observation = questions.length || proposal ? {
    ...posting, jobId: job.id, company: job.company, title: job.title, channel, profileSha256,
    stamp: formStamp(job, form), questions, ...(proposal?{proposal}:{}), otherBlockers: [...labels].some(label => !covered.has(cleanField(label))),
  } : null;
  await withInboxLock(store, async () => {
    if (await activeProfileHash(store) !== profileSha256) return;
    const state = await readGreenhouseAnswers(store);
    const index = state.observations.findIndex(o => o.key === posting.key && o.channel === channel);
    if (index === -1 && !observation) return;
    if (index !== -1 && JSON.stringify(state.observations[index]) === JSON.stringify(observation)) return;
    if (index !== -1) state.observations.splice(index, 1);
    if (observation) state.observations.push(observation);
    await store.write(filename, state);
  });
}

async function activeProfileHash(store) {
  const [profile, policy] = await Promise.all([
    store.read('application-profile.json', null), store.read('application-policy.json', {}),
  ]);
  if (!profile?.verified) return null;
  const hash = digest(profile);
  return policy.verifiedProfileSha256 && policy.verifiedProfileSha256 !== hash ? null : hash;
}

async function liveObservations(store, state, profileSha256) {
  if (!profileSha256 || state.observations.length === 0) return [];
  const [ledger, jobs] = await Promise.all([store.read('application-ledger.json', []), store.read('jobs.json', null)]);
  const startedIds = new Set(), startedKeys = new Set(), legacyKeys = new Set();
  for (const attempt of ledger) {
    if (attempt.status === 'preflight_hold') continue;
    startedIds.add(attempt.jobId);
    const key = (applicationPosting(attempt.url) || greenhousePosting(attempt.url))?.key;
    if (key) startedKeys.add(key);
    else if (attempt.postingKey) legacyKeys.add(attempt.postingKey);
  }
  const knownJobs = jobs && new Map(jobs.map(job => [job.id, job]));
  const skipped=new Set((state.permissions||[]).filter(p=>p.decision==='skip').map(p=>p.postingKey));
  return state.observations.filter(o => {
    if(skipped.has(o.key))return false;
    if (o.profileSha256 !== profileSha256 || startedIds.has(o.jobId) || startedKeys.has(o.key) ||
        legacyKeys.has(o.postingOnly ? new URL(o.url).hostname + ':' + o.id : 'greenhouse:' + o.id)) return false;
    if (!knownJobs) return true;
    const job = knownJobs.get(o.jobId);
    return job && applicationPosting(job.url)?.key === o.key && job.title === o.title &&
      job.listingState !== 'unlisted' && !['applied', 'dismissed', 'rejected', 'interview', 'offer'].includes(job.status);
  });
}

function groupId(state, o, q) {
  const widest = q.scopes.at(-1);
  const revision = state.revisions?.[o.profileSha256 + ':' + q.key] || 0;
  return digest([o.profileSha256, q.key, widest, target(widest, o), revision]);
}

function advanceRevision(state, profileSha256, questionKey) {
  state.revisions ??= {};
  const key = profileSha256 + ':' + questionKey;
  state.revisions[key] = (state.revisions[key] || 0) + 1;
}

function summarize(state, observations) {
  const groups = new Map(), waiting = new Set(), ready = new Set(), permissions=[];
  for (const o of observations) {
    const decision=o.proposal && state.permissions?.find(p=>p.requestId===o.proposal.id && p.stamp===o.stamp);
    if(decision?.decision==='skip')continue;
    let hasMissing = Boolean(o.proposal && !decision);
    if(hasMissing)permissions.push({id:o.proposal.id,jobId:o.jobId,company:o.company,title:o.title,url:o.url,revision:o.stamp,
      ...(o.proposal.purpose ? {purpose:o.proposal.purpose} : {}),
      fields:o.proposal.fields.map(({label,answer,help,links})=>({label,answer,help,links}))});
    for (const q of o.questions) {
      if (grantFor(state, o, q)) continue;
      hasMissing = true;
      const id = groupId(state, o, q);
      if (!groups.has(id)) groups.set(id, { id, label: q.label, type: q.type, options: q.options, scopes: q.scopes, help: q.help, ...(q.purpose?{purpose:q.purpose}:{}), postings: [] });
      const choices = groups.get(id).postings;
      if (!choices.some(p => p.jobId === o.jobId && p.channel === o.channel)) {
        choices.push({ jobId: o.jobId, company: o.company, title: o.title, url: o.url, channel: o.channel, revision: o.stamp });
      }
    }
    if (o.channel !== 'worker') continue;
    if (hasMissing) waiting.add(o.jobId);
    else if (!o.otherBlockers) ready.add(o.jobId);
  }
  return { items: [...groups.values()], ...(permissions.length?{permissions}:{}), waitingJobIds: [...waiting], readyJobIds: [...ready] };
}

export async function readGreenhouseInbox(store, { includeObserved = false } = {}) {
  const state = await readGreenhouseAnswers(store);
  const profileSha256 = await activeProfileHash(store);
  const savedAnswers = state.grants.filter(g => g.profileSha256 === profileSha256).map(g => ({
    id: g.id, label: g.label, scope: g.scope, company: g.company, title: g.title, confirmedAt: g.confirmedAt,
  }));
  const observations = await liveObservations(store, state, profileSha256);
  const result = { ...summarize(state, observations), savedAnswers };
  if (includeObserved) {
    result.observed = new Map(observations.filter(o => o.channel === 'worker')
      .map(o => [o.jobId, new Set([...o.questions,...(o.proposal?.fields||[])].map(q => q.label))]));
    result.skippedKeys = new Set((state.permissions || []).filter(p => p.decision === 'skip').map(p => p.postingKey));
  }
  return result;
}

export async function greenhouseRetryJobs(store) {
  return (await readGreenhouseInbox(store)).readyJobIds;
}

export async function answerGreenhouseQuestion({ store, id, jobId, scope, answer, confirm, channel, revision }) {
  if (confirm !== true) throw Error('Explicitly confirm that this answer is accurate for the selected scope');
  return withInboxLock(store, async () => {
    const state = await readGreenhouseAnswers(store);
    const profileSha256 = await activeProfileHash(store);
    const observations = await liveObservations(store, state, profileSha256);
    const candidates = observations.filter(o => o.jobId === jobId && (!channel || o.channel === channel) && (!revision || o.stamp === revision))
      .map(o => ({ o, q: o.questions.find(q => groupId(state, o, q) === id) })).filter(row => row.q);
    if (!candidates.length) {
      // Retrying the same accepted request is harmless. A stale browser tab
      // cannot subsequently expand its grant or recreate a revoked answer.
      const previous = state.grants.find(g => g.profileSha256 === profileSha256 && g.requestId === id &&
        g.sourceJobId === jobId && g.scope === scope && g.answer === answer && (!channel || g.channel === channel));
      if (previous) return { jobIds: [] };
      throw Error('This Greenhouse question is stale or the posting is no longer actionable');
    }
    const { o, q } = candidates[0];
    if (!q.scopes.includes(scope)) throw Error('This scope is unavailable for the selected question');
    if (candidates.some(row => target(scope, row.o) !== target(scope, o))) throw Error('Choose the specific manual or worker observation before saving this answer');
    if (!validValue(q, answer)) throw Error('Enter a valid answer for the observed field and choices');
    const binding = target(scope, o);
    const existing = state.grants.find(g => g.scope === scope && g.profileSha256 === o.profileSha256 &&
      g.questionKey === q.key && g.target === binding);
    if (existing && existing.answer !== answer) throw Error('An answer was already saved for this scope. Refresh the inbox.');
    if (!existing) {
      state.grants.push({ id: randomUUID(), requestId: id, label: q.label, company: o.company, title: o.title,
        profileSha256: o.profileSha256, questionKey: q.key, scope, target: binding, answer,
        sourceJobId: o.jobId, channel: o.channel, confirmedAt: new Date().toISOString() });
      advanceRevision(state, o.profileSha256, q.key);
      await store.write(filename, state);
    }
    const applicable = observations.filter(other => other.channel === 'worker' && !other.otherBlockers &&
      ( !other.proposal || state.permissions?.some(p=>p.requestId===other.proposal.id && p.stamp===other.stamp && p.decision==='allow')) &&
      other.questions.every(item => grantFor(state, other, item)) && other.questions.some(item =>
        item.key === q.key && target(scope, other) === binding));
    return { jobIds: [...new Set(applicable.map(other => other.jobId))] };
  });
}


export async function forgetGreenhouseAnswer({ store, id }) {
  return store.lock(() => withInboxLock(store, async () => {
    const active = await activeProfileHash(store), state = await readGreenhouseAnswers(store);
    const index = state.grants.findIndex(g => g.id === id && g.profileSha256 === active);
    if (index === -1) throw Error('This saved answer is no longer available in this profile');
    const [removed] = state.grants.splice(index, 1);
    advanceRevision(state, removed.profileSha256, removed.questionKey);
    await store.write(filename, state);
    return { forgotten: true };
  }));
}
