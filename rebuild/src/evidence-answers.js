// An applicant reply is a private source for the reviewer. Recording it does
// not change a qualification, the approved résumé, or the application's status.
import { qualityDigest } from './quality.js';

export function evidenceQuestionScope(postingDigest, profileDigest) {
  return qualityDigest({postingDigest,profileDigest});
}

export function openEvidenceQuestions(questions, records, scope) {
  const answered = new Set(records.filter(record => record.scope === scope).map(record => record.question));
  return questions.filter(question => !answered.has(question));
}
