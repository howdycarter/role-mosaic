import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApplicationStore } from './applications.js';
import { identity, mergeJobs } from './core.js';
import { fetchBoard } from './sources.js';

const boardKey = board => board.type + '/' + board.slug;

// The calendar entry point only reads public job boards. No application worker,
// Notion refresh, browser, résumé or applicant profile is needed for this scan.
export async function scanBoards({ store, fetcher = fetch, shouldStop = () => false, now = () => new Date() }) {
  const { boards } = await store.read('connections.json', {});
  if (!Array.isArray(boards) || !boards.length) throw Error('Configure at least one employer board.');
  const unique = [...new Map(boards.map(board => [boardKey(board), board])).values()];
  const startedAt = now().toISOString();
  const reports = [], listings = [], successful = new Set();

  for (let offset = 0; offset < unique.length && !shouldStop(); offset += 4) {
    const batch = unique.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map(board => fetchBoard(board, fetcher)));
    for (const [i, result] of results.entries()) {
      const source = boardKey(batch[i]);
      if (result.status === 'rejected') {
        reports.push({ source, status: 'failed', reason: String(result.reason?.message || 'Board request failed').slice(0, 180) });
        continue;
      }
      successful.add(source);
      listings.push(...result.value);
      reports.push({ source, status: 'ok', fetched: result.value.length });
    }
  }
  const failures = reports.filter(report => report.status === 'failed');
  const status = reports.length < unique.length ? 'paused' : !successful.size ? 'failed' : failures.length ? 'partial' : 'ok';
  const summary = {
    startedAt, at: now().toISOString(), status, boards: unique.length, succeeded: successful.size,
    fetched: listings.length, failures, sources: reports,
  };
  return store.lock(async () => {
    const previous = await store.read('discovery-state.json', {});
    // Two entry points can fetch concurrently. An older snapshot must never
    // undo a newer scan's observed source membership or overwrite its health.
    if (previous.startedAt > startedAt) return { ...summary, status: 'superseded' };
    const existing = await store.read('jobs.json', []);
    const seen = new Set(listings.map(identity));
    const existingIds = new Set(existing.map(identity));
    const jobs = mergeJobs(existing, listings);
    let unlisted = 0;
    for (const job of jobs) {
      if (!successful.has(job.source)) continue;
      if (seen.has(identity(job))) {
        job.listingState = 'listed';
        delete job.unlistedAt;
      } else if (job.listingState !== 'unlisted') {
        job.listingState = 'unlisted';
        job.unlistedAt = summary.at;
        unlisted++;
      }
    }
    summary.added = [...seen].filter(id => !existingIds.has(id)).length;
    summary.unlisted = unlisted;
    summary.saved = jobs.length;
    if (successful.size) await store.write('jobs.json', jobs);
    summary.lastFullScanAt = status === 'ok' ? summary.at : previous.lastFullScanAt || null;
    await store.write('discovery-state.json', summary);
    return summary;
  });
}

export function discoveryMessage(result) {
  if (result.status === 'superseded') return 'A newer discovery scan was already saved.';
  return `Discovery ${result.status}: ${result.succeeded}/${result.boards} boards read, ${result.fetched} postings retrieved, ${result.added} newly saved, ${result.unlisted} newly absent from their board, ${result.saved} retained.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (!process.env.ROLEMOSAIC_HOME) throw Error('Set ROLEMOSAIC_HOME to the initialized private workspace.');
    const result = await scanBoards({ store: new ApplicationStore(process.env.ROLEMOSAIC_HOME) });
    console.log(discoveryMessage(result));
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) {
    console.error('Discovery failed: ' + error.message);
    process.exitCode = 1;
  }
}
