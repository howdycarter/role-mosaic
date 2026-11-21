// A previously reviewed qualification can be reused only with the same wording and verified evidence.
// Unclassified clauses stay open for research. They are never silently counted as reviewed.
import { htmlText } from './career.js';
import { assessQuality, jobDigest, roleTrack } from './quality.js';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const sevenDays = 7 * 86400000;

function readQualifications(description) {
  const start = /^(?:(?:required|minimum|basic|essential) (?:qualifications|requirements)|qualifications|requirements|what you(?:’|')ll (?:bring|need))[:.]?$/i;
  const optional = /^(?:p\s*referred (?:qualifications|requirements|backgrounds?|experience)|nice.to.haves?|bonus(?: points| qualifications)?|benefits(?: and perks)?|compensation(?: and benefits)?|pay transparency)[:.]?$/i;
  const other = /^(?:responsibilities|about (?:us|the (?:company|team|role)))[:.]?$/i;
  const clauses = [];
  let section = 'unclassified', unclassifiedText = false;
  for (const raw of htmlText(htmlText(description || '')).split(/\n+/)) {
    const line = clean(raw);
    if (!line) continue;
    if (start.test(line)) section = 'required';
    else if (optional.test(line)) section = 'optional';
    else if (other.test(line)) section = 'unclassified';
    else if (section === 'required') clauses.push(line);
    else if (section === 'unclassified' || /\b(?:must|required to|mandatory|only eligible|need to have)\b/i.test(line)) unclassifiedText = true;
  }
  return {clauses:[...new Set(clauses)], unclassifiedText};
}

export function mandatoryClauses(description) {
  return readQualifications(description).clauses;
}

function usableReview(review, evidence, resume, now) {
  const age = now.getTime()-Date.parse(review?.reviewedAt);
  return review?.allMandatoryReviewed === true && typeof review.reviewer === 'string' && review.reviewer.trim() &&
    review.evidenceDigest === evidence.digest && review.resumeSha256 === resume.sha256 &&
    age >= 0 && age < sevenDays && Array.isArray(review.requirements);
}

function portable(text) {
  // Terms that depend on an employer, this job, or a specific time need a fresh reading.
  return !/\b(?:our|ours|us|here|similar role|related field|relevant experience|this (?:role|company|team)|currently|past (?:year|month)|last (?:year|month))\b/i.test(text);
}

export function reviewWithEvidence(job, evidence, resume, reviews, now = new Date()) {
  const track = roleTrack(job.title);
  const facts = evidence.facts.filter(f => f.tracks.includes(track));
  const ids = new Set(facts.map(f => f.id));
  const current = reviews[job.id];
  const bound = current && current.jobDigest === jobDigest(job) && usableReview(current,evidence,resume,now);
  const {clauses:required,unclassifiedText} = readQualifications(job.description);
  let review = current, rows;
  if (required.length) {
    const prior = Object.entries(reviews).filter(([id,r]) => id!==job.id && r?.track===track && usableReview(r,evidence,resume,now));
    const anchors = [];
    rows = required.map(text => {
      const exact = row => row && clean(row.text) === text && Array.isArray(row.evidenceIds) && row.evidenceIds.every(id=>ids.has(id));
      const existing = bound && current.requirements.find(exact);
      if (existing) { anchors.push(current); return existing; }
      if (portable(text)) {
        const matches = prior.flatMap(([,r])=>r.requirements.filter(exact).map(row=>({row,review:r})));
        if (matches.length && matches.every(m=>m.row.status==='supported' && m.row.evidenceIds.length)) {
          const source = matches.sort((a,b)=>Date.parse(b.review.reviewedAt)-Date.parse(a.review.reviewedAt))[0];
          anchors.push(source.review);
          return {text,status:'supported',evidenceIds:source.row.evidenceIds};
        }
      }
      return {text,status:'unknown',evidenceIds:[]};
    });
    // Retain explicit judgments of mandatory clauses outside the parsed section.
    if (bound) rows.push(...current.requirements.filter(row=>!required.includes(clean(row.text))));
    // Reuse only explicit human/operator assessments; never stamp a new review date or extend its lifetime.
    if (anchors.length) review = {
      jobDigest:jobDigest(job),evidenceDigest:evidence.digest,resumeSha256:resume.sha256,
      sources:[...new Set(anchors)].map(r=>({jobDigest:r.jobDigest,reviewer:r.reviewer,reviewedAt:r.reviewedAt})),
      reviewer: 'Mosaic using verified role reviews', reviewedAt:anchors.map(r=>r.reviewedAt).sort()[0],
      allMandatoryReviewed:!!(bound || !unclassifiedText) && rows.every(r=>r.status==='supported'), requirements:rows,
    };
    else review=undefined;
    if (bound && required.every(text=>current.requirements.some(r=>clean(r.text)===text && rows.includes(r)))) review=current;
  } else if (bound) rows = current.requirements;
  const assessment = assessQuality(job,evidence,{resume,review,now});
  const applicantQuestions = [...new Set((rows || []).filter(r=>r.status==='unknown')
    .flatMap(r=>Array.isArray(r.questions)?r.questions:[]).filter(q=>typeof q==='string'&&q.trim()))];
  return {assessment,requirements:rows,applicantQuestions,
    contradicted:(rows||[]).some(r=>r.status==='contradicted'),
    handsOnPreference:track==='fde' && facts.some(f=>f.capabilities.includes('applicant-hands-on-work-preference'))};
}
