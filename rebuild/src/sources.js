const allowed = new Set(['greenhouse', 'lever', 'ashby']);
export async function fetchBoard(board, fetcher = fetch) {
  if (!allowed.has(board.type) || !/^[a-zA-Z0-9_-]+$/.test(board.slug)) throw new Error('Invalid board type or slug');
  const endpoints = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`,
    lever: `https://api.lever.co/v0/postings/${board.slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${board.slug}`,
  };
  const response = await fetcher(endpoints[board.type], { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`${board.type}/${board.slug}: HTTP ${response.status}`);
  const body = await response.json();
  const rows = board.type === 'lever' ? body : body.jobs;
  if (!Array.isArray(rows)) throw new Error('Unexpected board response');
  const seenAt = new Date().toISOString();
  return rows.map(j => ({
    company: board.company, title: j.title || j.text || '',
    location: typeof j.location === 'string' ? j.location : j.location?.name || j.categories?.location || '',
    url: j.absolute_url || j.hostedUrl || j.jobUrl || '',
    source: `${board.type}/${board.slug}`, seenAt,
  })).filter(j => j.title && /^https:\/\//.test(j.url));
}
