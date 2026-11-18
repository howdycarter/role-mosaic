// Read-only view. Actions use the same packet, receipt and application workflows as the dashboard.
import { postingKey } from './applications.js';
import { createHistoryLookup, historyMatch, reapplicationHistory } from './core.js';
import { greenhousePosting, readGreenhouseInbox } from './greenhouse-inbox.js';
import { confirmedReceipt } from './outcomes.js';

const normalize = text => String(text ?? '').replace(/\s+/g, ' ').trim().replace(/\s*\*+$/, '').trim();
function key(url) {
  const hosted = greenhousePosting(url);
  if (hosted) return 'greenhouse/' + hosted.key;
  try { return postingKey(url); } catch { return null; }
}

export async function readDecisionInbox(store) {
  // A cache miss can touch a large inventory. Each request snapshot reads each file once.
  const reads = new Map();
  const snapshot = { read(name, fallback) {
    if (!reads.has(name)) reads.set(name, store.read(name, fallback));
    return reads.get(name);
  } };
  const [greenhouse, plan, ledger] = await Promise.all([
    readGreenhouseInbox(snapshot, { includeObserved: true }), snapshot.read('application-plan.json', {held:[]}),
    snapshot.read('application-ledger.json', []),
  ]);
  const { observed, ...inbox } = greenhouse;
  const reviews = [];
  const confirmed = new Set(ledger.filter(confirmedReceipt).map(a => key(a.url)).filter(Boolean));
  for (const a of ledger) {
    if (!['held', 'submission_unknown'].includes(a.status) || confirmed.has(key(a.url))) continue;
    reviews.push({ kind: a.status === 'held' ? 'draft' : 'receipt', attemptId:a.id, company:a.company,
      title:a.title, reason:a.reason || (a.status === 'held' ? 'Draft requires review' : 'Employer confirmation is pending') });
  }
  if (!plan.held?.length) return { ...inbox, reviews };
  const [jobs, history, exceptions, quality] = await Promise.all([
    snapshot.read('jobs.json', []), snapshot.read('history.json', []), snapshot.read('reapplication-reviews.json', []),
    snapshot.read('quality-packets.json', {packets:[]}),
  ]);
  const inventory = new Map((jobs || []).map(j => [j.id,j]));
  const attemptedIds = new Set(ledger.filter(a => a.status !== 'preflight_hold').map(a => a.jobId));
  const attemptedKeys = new Set(ledger.filter(a => a.status !== 'preflight_hold').map(a => key(a.url)).filter(Boolean));
  const historyFor = createHistoryLookup(history);
  const reviewedPostings = new Set(exceptions.map(e => key(e.posting)).filter(Boolean));
  const packets = new Map((quality.packets || []).map(p => [p.job.id, p.id]));
  for (const hold of plan.held) {
    const job = inventory.get(hold.id);
    if (!job || !['new', 'saved'].includes(job.status || 'new') || job.listingState === 'unlisted') continue;
    const posting = key(job.url);
    if (attemptedIds.has(job.id) || attemptedKeys.has(posting)) continue;
    if (historyFor(job) && (!reviewedPostings.has(posting) || historyMatch(job, reapplicationHistory(job, history, exceptions)))) continue;
    let kind = 'posting', questions = (hold.questions || []).filter(q => typeof q === 'string');
    if (hold.reason === 'Missing verified answers or supported controls') {
      kind = 'form';
      // Both saved and unanswered supported fields have their own scoped workflow.
      const handled = observed.get(job.id);
      questions = questions.filter(q => !handled?.has(normalize(q)));
      if (!questions.length && handled?.size) continue;
    } else if (hold.reason === 'Application quality review required') kind = 'evidence';
    else if (hold.reason === 'Individual-contributor specialization requires review') kind = 'evidence';
    else if (!/review|verification|sign-in|could not be inspected/i.test(hold.reason)) continue;
    reviews.push({kind,jobId:job.id,company:job.company,title:job.title,url:job.url,reason:hold.reason,
      questions,packetId:kind === 'evidence' ? packets.get(job.id) : undefined});
  }
  return { ...inbox, reviews };
}
