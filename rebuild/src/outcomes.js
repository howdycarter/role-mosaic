import { ApplicationStore, postingKey, samePosting } from './applications.js';
import { mongoEmbedRoute } from './greenhouse-embed.js';

const stages = ['screen-invite', 'interview-invite', 'offer', 'rejected', 'closed', 'alternate-lead'];
const progression = new Set(['screen-invite', 'interview-invite', 'offer']);
const dayMs = 86_400_000;
const utcDay = date => date.toISOString().slice(0, 10);

// Greenhouse redirects its older hosted board domain to the current domain.
function receiptMatchesPosting(received, requested) {
  const hosts = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);
  function hostedJob(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.has(url.hostname)) return null;
      const match = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)(?:\/confirmation)?\/?$/);
      if (!match || postingKey(raw) !== 'greenhouse:' + match[2]) return null;
      return [match[1], match[2]];
    } catch { return null; }
  }
  try {
    const embed = mongoEmbedRoute(requested);
    if (embed) {
      const receipt = mongoEmbedRoute(received);
      if (receipt) return receipt.kind === 'form' && receipt.key === embed.key;
      const hosted = hostedJob(received);
      return !!hosted && hosted[0] === embed.board && hosted[1] === embed.id;
    }
    if (![received, requested].some(raw => hosts.has(new URL(raw).hostname))) return samePosting(received, requested);
  } catch { return false; }
  const a = hostedJob(received), b = hostedJob(requested);
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

export function confirmedReceipt(attempt) {
  const receipt = attempt?.receipt;
  if (attempt?.status !== 'submitted' || receipt?.confirmed !== true ||
      ![receipt.text, receipt.confirmationText].some(text => typeof text === 'string' && text.trim()) ||
      !receiptMatchesPosting(receipt.posting, attempt.url)) return null;
  const time = Date.parse(attempt.submittedAt ?? receipt.verifiedAt ?? attempt.createdAt);
  if (!Number.isFinite(time)) return null;
  return { key: postingKey(attempt.url), time };
}

export function summarizeOutcomes(ledger, events, { now = new Date(), resumeSha256 } = {}) {
  const postings = new Map();
  const confirmedAttempts = new Map();
  const uncertain = new Set();
  let unverifiedSubmitted = 0;
  for (const attempt of ledger) {
    if (resumeSha256 && attempt.resumeSha256 !== resumeSha256) continue;
    const receipt = confirmedReceipt(attempt);
    if (receipt && receipt.time <= now.getTime()) {
      confirmedAttempts.set(attempt.id, receipt.key);
      const previous = postings.get(receipt.key);
      if (!previous || receipt.time < previous.time) postings.set(receipt.key, receipt);
    } else if (attempt.status === 'submitted') {
      unverifiedSubmitted++;
    } else if (attempt.status === 'submission_unknown' && samePosting(attempt.url, attempt.url)) {
      uncertain.add(postingKey(attempt.url));
    }
  }
  const byPosting = new Map();
  for (const event of events) {
    if (confirmedAttempts.get(event.attemptId) !== event.postingKey || !postings.has(event.postingKey) ||
        !stages.includes(event.stage) || event.date > utcDay(now)) continue;
    if (!byPosting.has(event.postingKey)) byPosting.set(event.postingKey, []);
    byPosting.get(event.postingKey).push(event);
  }
  const observed = Object.fromEntries(stages.map(stage => [stage, 0]));
  let priorContact = 0, mature = 0, advanced = 0, noRecordedOutcome = 0;
  for (const [key, receipt] of postings) {
    uncertain.delete(key);
    const recorded = byPosting.get(key) ?? [];
    for (const stage of new Set(recorded.map(event => event.stage))) observed[stage]++;
    if (!recorded.length) noRecordedOutcome++;
    if (recorded.some(event => event.attribution === 'prior-contact')) {
      priorContact++;
      continue;
    }
    const firstDay = Date.parse(utcDay(new Date(receipt.time)));
    const today = Date.parse(utcDay(now));
    if (today - firstDay < 30 * dayMs) continue;
    mature++;
    if (recorded.some(event => progression.has(event.stage) && Date.parse(event.date) >= firstDay &&
        Date.parse(event.date) - firstDay < 30 * dayMs)) advanced++;
  }
  return {
    confirmed: postings.size, unresolved: uncertain.size, unverifiedSubmitted, noRecordedOutcome,
    observed, priorContact,
    first30Days: { mature, advanced, pending: postings.size - priorContact - mature,
      recordedProgressionRate: mature ? advanced / mature : null },
  };
}

export async function recordOutcome(home, { attempt: id, stage, date, reference, attribution = 'same-posting' }, now = new Date()) {
  if (!stages.includes(stage)) throw Error('Choose an outcome stage: ' + stages.join(', '));
  if (!['same-posting', 'prior-contact'].includes(attribution)) throw Error('Choose same-posting or prior-contact attribution');
  const time = Date.parse(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || utcDay(new Date(time)) !== date || date > utcDay(now)) {
    throw Error('Provide a valid UTC outcome date, today or earlier');
  }
  if (typeof reference !== 'string' || !reference.trim() || reference.length > 240 || /[\r\n]/.test(reference)) {
    throw Error('Provide a short source reference, such as an email message ID');
  }
  const store = new ApplicationStore(home);
  return store.lock(async () => {
    const ledger = await store.read('application-ledger.json', []);
    const attempt = ledger.find(entry => entry.id === id);
    const receipt = confirmedReceipt(attempt);
    if (!receipt) throw Error('An exact attempt ID with a confirmed employer receipt is required');
    if (date < utcDay(new Date(receipt.time)) && attribution !== 'prior-contact') {
      throw Error('This outcome predates submission. Use prior-contact attribution for verified earlier contact.');
    }
    const events = await store.read('application-outcomes.json', []);
    const event = { postingKey: receipt.key, attemptId: id, stage, date, reference: reference.trim(), attribution };
    if (events.some(row => row.postingKey === receipt.key && row.stage === stage && row.date === date &&
        row.reference === event.reference && row.attribution === attribution)) return { recorded: false, stage, date };
    await store.write('application-outcomes.json', [...events, { ...event, recordedAt: now.toISOString() }]);
    return { recorded: true, stage, date };
  });
}
