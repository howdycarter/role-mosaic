import { canonical, createHistoryLookup, evaluate } from './core.js';
import { postingKey, samePosting } from './applications.js';
import { roleTrack, tracks } from './quality.js';
import { employerPostingUrl, livePostingEvidence } from './sources.js';

// Some employers publish Greenhouse requisitions on their own careers domain.
export async function inspectShortlistPosting(job, fetcher = fetch, search = {}) {
  const url = new URL(job.url);
  const board = /^greenhouse\/([a-z0-9_-]+)$/i.exec(job.source || '');
  if (!board || ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname)) {
    return livePostingEvidence(job, fetcher, search);
  }
  const id = url.searchParams.get('gh_jid');
  if (!id || !/^\d+$/.test(id) || id !== job.sourceId) return null;
  const hostedUrl = 'https://job-boards.greenhouse.io/' + board[1] + '/jobs/' + id;
  let employerUrlVerified = false;
  async function verifyEmployerUrl(resource, options) {
    const response = await fetcher(resource, options);
    if (resource.startsWith('https://boards-api.greenhouse.io/') && response.ok) {
      const row = await response.clone().json();
      try {
        employerUrlVerified = canonical(employerPostingUrl('greenhouse', row.absolute_url, row.id)) === canonical(job.url);
      } catch { employerUrlVerified = false; }
    }
    return response;
  }
  const evidence = await livePostingEvidence({ ...job, url: hostedUrl }, verifyEmployerUrl, search);
  return evidence && employerUrlVerified ? { ...evidence, posting: job.url } : null;
}

export async function researchShortlist({ jobs, search, history, ledger, track, limit = 10, inspect = inspectShortlistPosting }) {
  if (!tracks.includes(track) || !Number.isInteger(limit) || limit < 1 || limit > 30) {
    throw Error('Choose a supported career track and a limit between 1 and 30');
  }
  const known = createHistoryLookup(history);
  const prior = new Set([...ledger.map(a => a.url), ...history.map(row => row.posting)]
    .filter(url => samePosting(url, url)).map(postingKey));
  const candidates = [];
  for (const job of jobs) {
    if (roleTrack(job.title) !== track || job.listingState !== 'listed' || !['new', 'saved'].includes(job.status ?? 'new') ||
        !samePosting(job.url, job.url) || prior.has(postingKey(job.url)) || known(job)) continue;
    const fit = evaluate(job, search);
    if (fit.reasons.every(reason => reason === 'Annual USD base compensation needs verification')) {
      candidates.push({ job, fit });
    }
  }
  candidates.sort((a, b) => a.fit.reasons.length - b.fit.reasons.length ||
    String(b.job.firstSeen || '').localeCompare(String(a.job.firstSeen || '')) || a.job.id.localeCompare(b.job.id));
  const results = [], selected = candidates.slice(0, limit);
  for (const { job } of selected) {
    const row = { company: job.company, role: job.title, jobId: job.id, url: job.url };
    let evidence;
    try { evidence = await inspect(job, undefined, search); }
    catch { results.push({ ...row, review: ['Live employer lookup failed'] }); continue; }
    if (!evidence || !samePosting(evidence.posting, job.url) ||
        job.title.trim().toLowerCase() !== String(evidence.title).trim().toLowerCase()) {
      results.push({ ...row, review: ['Current employer title and posting need verification'] });
      continue;
    }
    const live = evaluate({ ...job, location: evidence.location, compensation: evidence.compensation }, search);
    results.push({ ...row, location: evidence.location, base: evidence.compensation, source: evidence.sourceUrl,
      review: live.reasons.length ? live.reasons : ['Review geographic pay tier, mandatory experience and portfolio evidence'],
      passesLiveSearchRules: live.disposition === 'match' });
  }
  results.sort((a, b) => Number(b.passesLiveSearchRules === true) - Number(a.passesLiveSearchRules === true));
  return { track, candidates: candidates.length, checked: results.length, results };
}
