import path from 'node:path';
import { answerFor, digest, postingKey } from './applications.js';
import { greenhouseAnswerFor, greenhousePosting, observeGreenhouseQuestions, readGreenhouseAnswers } from './greenhouse-inbox.js';
import { refreshPacket } from './packets.js';
import { evaluate } from './core.js';
import { livePostingEvidence } from './sources.js';

export function isHostedGreenhouseJob(raw) {
  const posting = greenhousePosting(raw);
  return Boolean(posting && !posting.confirmation);
}

export async function checkPacketQuestions({ store, packetId, fetcher = fetch, cached = {} }) {
  if (typeof packetId !== 'string' || !/^[a-f0-9]{64}$/.test(packetId)) throw Error('Choose a saved evidence packet.');
  const packet = await store.read(path.join('packets', packetId + '.json'), null);
  if (packet?.id !== packetId) throw Error('Evidence packet unavailable.');
  const jobs = cached.jobs ?? await store.read('jobs.json', []);
  const current = await refreshPacket(store.root, packet, {...cached, jobs});
  if (current.stale || !isHostedGreenhouseJob(current.job.url)) throw Error('Choose a current Greenhouse evidence packet.');
  const [profile, policy] = await Promise.all([
    store.read('application-profile.json', null), store.read('application-policy.json', {}),
  ]);
  if (!profile?.verified || !profile.facts || digest(profile) !== policy.verifiedProfileSha256) {
    throw Error('Verify your local application profile before checking questions.');
  }
  const job = jobs.find(item => item.id === current.job.id), profileSha256 = digest(profile);
  const evidence = await livePostingEvidence(job, fetcher, { includeQuestions: true });
  if (!evidence?.publicForm || evidence.posting !== job.url ||
      evidence.title.trim().toLowerCase() !== job.title.trim().toLowerCase()) {
    throw Error('Greenhouse could not confirm the current posting and public questions.');
  }
  const form = evidence.publicForm;
  const scoped = { ...profile, applyingCompany: job.company, scopePostingKey: postingKey(job.url) };
  const missing = form.fields.filter(field => !answerFor(field, scoped, job)).map(field => field.label);
  await observeGreenhouseQuestions({ store, job, form, missing, profileSha256, channel: 'manual' });
  const state = await readGreenhouseAnswers(store);
  const saved = [];
  for (const field of form.fields) {
    const answer = greenhouseAnswerFor(state, { job, field, form, profileSha256 });
    if (answer !== undefined) saved.push({ label: field.label, answer });
  }
  return { company: job.company, title: job.title, checked: form.fields.length, saved };
}

// One dashboard run checks only current matches in its own bounded packet batch.
// Reuse the inventory snapshot across packets instead of parsing it for every lookup.
export async function checkRunQuestions({store, packets, fetcher, shouldStop}) {
  const counts = {checked: 0, failed: 0, skipped: packets.length};
  if (!packets.length || shouldStop()) return counts;
  const [jobs, config, ledger, history] = await Promise.all([
    store.read('jobs.json', []), store.read('search.json', {}),
    store.read('application-ledger.json', []), store.read('history.json', []),
  ]);
  const byId = new Map(jobs.map(job => [job.id, job]));
  const seen = new Set();
  for (const row of [...ledger, ...history]) {
    const url = row.url || row.posting;
    if (url) {
      try { seen.add(postingKey(url)); } catch { /* Older imports may lack a valid posting URL. */ }
    }
    if (row.postingKey) seen.add(row.postingKey);
  }
  const eligible = packets.filter(packet => {
    const job = byId.get(packet.job.id);
    if (!job || !['new', 'saved'].includes(job.status || 'new') ||
        !isHostedGreenhouseJob(job.url) || evaluate(job, config).disposition !== 'match') return false;
    const key = postingKey(job.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!eligible.length) return counts;
  const [profile, policy] = await Promise.all([
    store.read('application-profile.json', null), store.read('application-policy.json', {}),
  ]);
  if (!profile?.verified || !profile.facts || digest(profile) !== policy.verifiedProfileSha256) {
    return {...counts, reason: 'Verify your local application profile to check Greenhouse questions.'};
  }
  for (const packet of eligible) {
    if (shouldStop()) break;
    counts.skipped--;
    try {
      await checkPacketQuestions({store, packetId: packet.id, fetcher, cached: {jobs, config, history, ledger}});
      counts.checked++;
    } catch {
      // An unavailable form must not prevent checks at independent employers.
      counts.failed++;
    }
  }
  return counts;
}
