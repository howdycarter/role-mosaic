import { digest, meetsContributorRule, postingKey, standingAuthorizationMatches } from './applications.js';
import { evidenceQuestionScope, openEvidenceQuestions } from './evidence-answers.js';
import { mandatoryClauses, reviewWithEvidence } from './evidence-review.js';
import { htmlText } from './career.js';
import { makeRoleReview } from './packets.js';
import { jobDigest, loadEvidence, roleTrack, selectTrackResume } from './quality.js';

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

async function reviewContext(store, jobId) {
  const [plan, jobs, ledger, reviews, policy, profile, search, replies] = await Promise.all([
    store.read('application-plan.json', {held:[]}), store.read('jobs.json', []), store.read('application-ledger.json', []),
    store.read('quality-reviews.json', {}), store.read('application-policy.json', {}), store.read('application-profile.json', {}), store.read('search.json', {}), store.read('evidence-replies.json', []),
  ]);
  const job = jobs.find(j => j.id === jobId);
  const hold = plan.held?.find(h => h.id === jobId && /quality review required|specialization requires review/i.test(h.reason));
  if (!hold || !job || !['new','saved'].includes(job.status || 'new') || job.listingState === 'unlisted' ||
      ledger.some(a => a.jobId === jobId && a.status !== 'preflight_hold')) throw Error('This role no longer has an open evidence review.');
  const track = roleTrack(job.title);
  const [evidence, resume] = await Promise.all([loadEvidence(store.root), selectTrackResume(store.root, track)]);
  const previous = reviews[jobId];
  const derived = reviewWithEvidence(job,evidence,resume,reviews), {assessment} = derived;
  const description = htmlText(htmlText(job.description || ''));
  const scope = {resumeSha256:resume.sha256, searchSha256:digest(search), profileSha256:digest(profile)};
  const canReviewIC = policy.enabled && policy.submissionMode === 'automatic' && policy.automationRiskAcknowledged === true &&
    resume.status === 'approved' && policy.verifiedProfileSha256 === scope.profileSha256 &&
    standingAuthorizationMatches(policy,scope,{transport:'playwright'});
  const priorIC = (policy.individualContributorReviews || []).filter(r => r.jobId === jobId);
  const questionScope = evidenceQuestionScope(assessment.jobDigest,scope.profileSha256);
  const applicantQuestions = openEvidenceQuestions(derived.applicantQuestions,replies,questionScope);
  const revision = digest([applicantQuestions,assessment.reviewDigest,assessment.jobDigest,assessment.evidenceDigest,resume.status,scope,previous||null,
    policy.standingAuthorization||null,policy.requireICReview !== false,priorIC,!!canReviewIC]);
  const priorCurrent = previous && previous.jobDigest === jobDigest(job) && previous.evidenceDigest === evidence.digest &&
    previous.resumeSha256 === resume.sha256;
  const view = {jobId,revision,applicantQuestions,description,company:job.company,title:job.title,url:job.url,track,
    resume:{status:resume.status, filename:resume.filename}, reasons:assessment.reasons,
    facts:evidence.facts.filter(f => f.tracks.includes(track)).map(({id,text,sourceId}) => ({id,text,sourceId})),
    requirements:derived.requirements || (priorCurrent ? previous.requirements : assessment.requirements.map(r => ({text:r.text,status:'unknown',evidenceIds:[]}))),
    needsIC:!meetsContributorRule(job,policy) && !(derived.handsOnPreference && policy.applicationResumeTrack===track && canReviewIC), canReviewIC:!!canReviewIC};
  return {view,assessment,job,evidence,resume,policy,reviews,scope,replies,questionScope};
}

export async function inboxRoleReview(store, jobId) {
  return (await reviewContext(store, jobId)).view;
}
export async function saveEvidenceReplies(store, data) {
  return store.lock(async () => {
    const {view,assessment,replies,questionScope} = await reviewContext(store,data.jobId);
    if (data.revision !== view.revision) throw Error('The questions or evidence changed. Reopen this item.');
    if (!Array.isArray(data.answers) || !data.answers.length || data.answers.length > 100)
      throw Error('Enter at least one answer.');
    const receivedAt = new Date().toISOString(), known = new Set(view.applicantQuestions);
    const added = data.answers.map(({question,answer}) => {
      if (!known.delete(question) || typeof answer !== 'string' || !answer.trim() || answer.length > 5000)
        throw Error('Answer a question shown for this posting.');
      const requirements = view.requirements.filter(row => row.status === 'unknown' && row.questions?.includes(question));
      return {scope:questionScope, jobId:view.jobId, postingDigest:assessment.jobDigest, reviewRevision:view.revision,
        evidenceDigest:assessment.evidenceDigest, question, answer:answer.trim(), requirements:requirements.map(row=>row.text),
        receivedAt, source:'Applicant response in the local Mosaic inbox', status:'awaiting-source-review'};
    });
    await store.write('evidence-replies.json',[...replies,...added]);
    return {saved:added.length,output:'Answer saved for source review. Mosaic will keep this application on hold until the evidence supports the qualification.'};
  });
}

export async function saveInboxRoleReview(store, data) {
  return store.lock(async () => {
    const {view,assessment,job,evidence,resume,policy,reviews,scope} = await reviewContext(store,data.jobId);
    if (data.revision !== view.revision) throw Error('The posting, sources, résumé or review changed. Reopen this review.');
    if (data.confirm !== true || typeof data.reviewer !== 'string' || !data.reviewer.trim() || data.reviewer.length > 200)
      throw Error('Identify the actual reviewer and confirm that every mandatory requirement was reviewed.');
    const facts = new Set(view.facts.map(f => f.id)), description = clean(view.description);
    if (!Array.isArray(data.requirements) || !data.requirements.length || data.requirements.length > 100)
      throw Error('List each mandatory requirement from the current posting.');
    const requirements = data.requirements.map(r => {
      if (typeof r?.text !== 'string' || !r.text.trim() || r.text.length > 3000 || !description.includes(clean(r.text)) ||
          !Array.isArray(r.evidenceIds) || r.evidenceIds.some(id => !facts.has(id)) ||
          (r.status === 'supported' && !r.evidenceIds.length)) throw Error('Quote each requirement from the posting and link verified facts to each supported claim.');
      return {text:clean(r.text),status:r.status,evidenceIds:[...new Set(r.evidenceIds)]};
    });
    const mandatory = [...mandatoryClauses(job.description),...assessment.requirements.map(row=>row.text)];
    if (mandatory.some(text => !requirements.some(row => clean(row.text)===clean(text))))
      throw Error('Include each identified mandatory requirement in the review.');
    const review = makeRoleReview(job,evidence,resume,data.reviewer,requirements);
    const {assessment:assessed} = reviewWithEvidence(job,evidence,resume,{...reviews,[job.id]:review});
    if (data.approveIC === true && (!view.needsIC || !view.canReviewIC || !assessed.ready ||
        typeof data.icEvidence !== 'string' || !data.icEvidence.trim() || data.icEvidence.length > 3000 ||
        !Array.isArray(data.icFactIds) || !data.icFactIds.length || data.icFactIds.some(id => !facts.has(id))))
      throw Error('Specialization review needs a current grant, a ready role review and an explanation linked to verified evidence.');
    await store.write('quality-reviews.json',{...reviews,[job.id]:review});
    if (data.approveIC === true) {
      const ic = {jobId:job.id,postingKey:postingKey(job.url),jobSha256:digest({title:job.title,location:job.location,description:job.description}),
        ...scope,reviewedAt:review.reviewedAt,reviewer:review.reviewer,evidence:data.icEvidence.trim(),evidenceIds:[...new Set(data.icFactIds)]};
      const retained = (policy.individualContributorReviews||[]).filter(r => r.jobId !== job.id);
      await store.write('application-policy.json',{...policy,individualContributorReviews:[...retained,ic]});
    }
    return {ready:assessed.ready,output: assessed.ready && (!view.needsIC || data.approveIC === true)
      ? 'Review saved. Run Mosaic to recheck this role against your current rules.'
      : 'Review saved. Resolve the remaining evidence or specialization requirements before applying.'};
  });
}
