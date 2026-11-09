import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.js';
import { postingKey, type Job } from './normalize.js';

type Row = { company?: string; role?: string; posting?: string; status?: string };
const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Conservative snapshot check: every exact historical match is held for review.
 * This cannot establish that the external tracker has not changed. */
export function historyRefusal(job: Pick<Job, 'company'|'title'|'url'>, file = path.join(PATHS.data, 'history', 'applications.json')): string | null {
  if (!existsSync(file)) return 'Imported history snapshot is missing';
  let rows: Row[];
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray((data as { applications?: unknown }).applications) || !(data as { applications: unknown[] }).applications.length) return 'Imported history snapshot is invalid';
    rows = (data as { applications: Row[] }).applications;
  } catch { return 'Imported history snapshot cannot be read'; }
  const match = rows.find(r => (r.posting && /^https?:\/\//i.test(r.posting) && postingKey(r.posting) === postingKey(job.url)) || (norm(r.company) !== '' && norm(r.company) === norm(job.company) && norm(r.role) !== '' && norm(r.role) === norm(job.title)));
  return match ? `Imported history match: ${match.status || 'status unknown'}; review before applying` : null;
}
