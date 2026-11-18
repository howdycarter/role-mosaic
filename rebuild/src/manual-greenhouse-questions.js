import path from 'node:path';
import { answerFor, digest, postingKey } from './applications.js';
import { greenhouseAnswerFor, greenhousePosting, observeGreenhouseQuestions, readGreenhouseAnswers } from './greenhouse-inbox.js';
import { refreshPacket } from './packets.js';
import { livePostingEvidence } from './sources.js';

export function isHostedGreenhouseJob(raw) {
  const posting = greenhousePosting(raw);
  return Boolean(posting && !posting.confirmation);
}

export async function checkPacketQuestions({ store, packetId, fetcher = fetch }) {
  if (typeof packetId !== 'string' || !/^[a-f0-9]{64}$/.test(packetId)) throw Error('Choose a saved evidence packet.');
  const packet = await store.read(path.join('packets', packetId + '.json'), null);
  if (packet?.id !== packetId) throw Error('Evidence packet unavailable.');
  const current = await refreshPacket(store.root, packet);
  if (current.stale || !isHostedGreenhouseJob(current.job.url)) throw Error('Choose a current Greenhouse evidence packet.');
  const [profile, policy] = await Promise.all([
    store.read('application-profile.json', null), store.read('application-policy.json', {}),
  ]);
  if (!profile?.verified || !profile.facts || digest(profile) !== policy.verifiedProfileSha256) {
    throw Error('Verify your local application profile before checking questions.');
  }
  const job = current.job, profileSha256 = digest(profile);
  const evidence = await livePostingEvidence(job, fetcher, { includeQuestions: true });
  if (!evidence?.publicForm || evidence.posting !== job.url ||
      evidence.title.trim().toLowerCase() !== job.title.trim().toLowerCase()) {
    throw Error('Greenhouse could not confirm the current posting and public questions.');
  }
  const form = evidence.publicForm;
  const scoped = { ...profile, applyingCompany: job.company, scopePostingKey: postingKey(job.url) };
  const missing = form.fields.filter(field => !answerFor(field, scoped)).map(field => field.label);
  await observeGreenhouseQuestions({ store, job, form, missing, profileSha256, channel: 'manual' });
  const state = await readGreenhouseAnswers(store);
  const saved = [];
  for (const field of form.fields) {
    const answer = greenhouseAnswerFor(state, { job, field, form, profileSha256 });
    if (answer !== undefined) saved.push({ label: field.label, answer });
  }
  return { company: job.company, title: job.title, checked: form.fields.length, saved };
}
