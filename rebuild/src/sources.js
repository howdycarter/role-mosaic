const allowed = new Set(['greenhouse', 'lever', 'ashby']);
export function salaryFromText(raw) {
 const text=String(raw).replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&#36;|&dollar;/g,'$').replace(/\s+/g,' ');
 const m=text.match(/(?:annual\s+)?base\s+(?:salary|pay|compensation)[^.]{0,90}?\$([\d,]+)\s*(?:-|–|—|to)\s*\$([\d,]+)/i);
 if(!m)return null;const context=text.slice(Math.max(0,m.index-50),m.index+m[0].length+90);
 if(!/\b(annual|annually|per year|yearly|a year)\b/i.test(context)||/\b(CAD|AUD|hourly|monthly|per hour)\b/i.test(context))return null;
 return {min:Number(m[1].replaceAll(',','')),max:Number(m[2].replaceAll(',','')),currency:'USD',interval:'year',evidence:m[0]};
}
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
    description: j.content || j.descriptionPlain || j.descriptionHtml || j.description || '',
    sourceId: String(j.id),
    compensation: salaryFromText(j.content || j.descriptionPlain || j.descriptionHtml || ''),
  })).filter(j => j.title && /^https:\/\//.test(j.url));
}
