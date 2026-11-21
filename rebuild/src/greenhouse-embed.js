// A reviewed employer integration. A gh_jid on an arbitrary website is never
// sufficient to select an application destination.
export function mongoEmbedRoute(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
  let id, kind;
  if (url.hostname === 'www.mongodb.com') {
    kind = 'employer';
    if (url.pathname === '/careers/job/' && url.searchParams.size === 1) id = url.searchParams.get('gh_jid');
    else if (!url.search) id = /^\/careers\/jobs\/(\d+)$/.exec(url.pathname)?.[1];
  } else if (url.hostname === 'job-boards.greenhouse.io' && url.pathname === '/embed/job_app' &&
             url.searchParams.size === 2 && url.searchParams.get('for') === 'mongodb') {
    kind = 'form';
    id = url.searchParams.get('token');
  }
  if (!id || !/^\d+$/.test(id)) return null;
  return {kind, board:'mongodb', id, key:'mongodb/'+id,
    url:'https://job-boards.greenhouse.io/embed/job_app?for=mongodb&token='+id, confirmation:false};
}

export async function verifyMongoEmbed(job, route, detail, fetcher) {
  if (job.source !== 'greenhouse/mongodb' || String(job.sourceId) !== route.id ||
      job.company.toLowerCase() !== 'mongodb' || detail.company_name !== 'MongoDB' ||
      detail.title !== job.title || String(detail.id) !== route.id ||
      mongoEmbedRoute(detail.absolute_url)?.kind !== 'employer' ||
      mongoEmbedRoute(detail.absolute_url)?.id !== route.id) return false;
  // Request the documented final employer route directly. Never follow a redirect
  // to another domain, board or requisition to establish this binding.
  const response = await fetcher('https://www.mongodb.com/careers/jobs/'+route.id,
    {redirect:'error',signal:AbortSignal.timeout(10000)});
  if (!response.ok) return false;
  const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, '');
  const title = /<title\b[^>]*>([^<]+)<\/title>/i.exec(html)?.[1].trim();
  return title === detail.title && /<script\b[^>]*\ssrc=(["'])https:\/\/boards\.greenhouse\.io\/embed\/job_board\/js\?for=mongodb\1[^>]*>/i.test(html);
}

export async function verifyMongoForm(page, job) {
  const intended = mongoEmbedRoute(job.url);
  if (!intended) return;
  const current = mongoEmbedRoute(page.url());
  if (current?.kind !== 'form' || current.key !== intended.key) throw Error('Employer application destination changed');
  const identity = await page.evaluate(() => {
    const forms = document.querySelectorAll('form#application-form');
    return {title:document.title, action:forms.length === 1 ? forms[0].action : null};
  });
  const action = mongoEmbedRoute(identity.action);
  if (identity.title !== 'Job Application for '+job.title+' at MongoDB' ||
      action?.kind !== 'form' || action.key !== intended.key) throw Error('Embedded application identity is unverified');
}
