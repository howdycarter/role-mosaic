import { createHash } from 'node:crypto';

const terms = (s, items = []) => items.filter(x => new RegExp(`(?:^|[^a-z0-9])${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(s));
export function identity(job) {
  const input = job.url ? job.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() : `${job.company}|${job.title}|${job.location}`.toLowerCase();
  return createHash('sha256').update(input).digest('hex').slice(0, 20);
}
export function evaluate(job, config) {
  const levels = terms(job.title, config.titleLevels);
  const fields = terms(job.title, config.titleFields);
  const local = terms(job.location, config.localCities);
  const remote = /\bremote\b/i.test(job.location) && /\b(united states|u\.?s\.?a?\.?|nationwide)\b/i.test(job.location) && !/\b(except|excluding|outside|canada|europe|uk|hybrid|on.?site)\b/i.test(job.location);
  const reasons = [];
  if (!levels.length) reasons.push('Title does not match a selected level');
  if (!fields.length) reasons.push('Title does not match a selected field');
  if (!local.length && !remote) reasons.push('Location needs review');
  if (/\b(intern|internship|unpaid)\b/i.test(job.title)) reasons.push('Excluded title');
  const score = (levels.length ? 40 : 0) + (fields.length ? 40 : 0) + (local.length || remote ? 20 : 0);
  return { score, reasons, matches: { levels, fields, location: local.length ? local : remote ? ['US remote'] : [] }, disposition: reasons.length ? 'review' : 'match' };
}
export function mergeJobs(existing, incoming) {
  const map = new Map(existing.map(j => [identity(j), j]));
  for (const job of incoming) {
    const id = identity(job); const old = map.get(id);
    map.set(id, { ...old, ...job, id, firstSeen: old?.firstSeen ?? job.seenAt, status: old?.status ?? 'new', note: old?.note ?? '' });
  }
  return [...map.values()];
}
export function historyMatch(job, rows) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return rows.find(r => (r.posting && job.url && r.posting.replace(/[?#].*$/, '').replace(/\/$/,'').toLowerCase() === job.url.replace(/[?#].*$/, '').replace(/\/$/,'').toLowerCase()) || (norm(r.company) && norm(r.company) === norm(job.company) && norm(r.role) && norm(r.role) === norm(job.title))) ?? null;
}
