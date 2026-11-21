import {htmlText} from './career.js';

const title = 'Senior Forward Deployed Engineer';
const companyPolicy = 'We are a fully remote global company with employees in Canada, the United States and Latin America.';
const travel = 'This role may require up to 50% travel, depending on business needs.';
const normalize = value => htmlText(htmlText(String(value || ''))).replace(/\s+/g, ' ').trim();
const geography = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New (?:Hampshire|Jersey|Mexico|York)|North (?:Carolina|Dakota)|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South (?:Carolina|Dakota)|Tennessee|Texas|Utah|Vermont|Virginia|Washington|Wisconsin|Wyoming|District of Columbia|Pacific|Eastern|Central|Mountain|Canada|Canadian|Mexico|Latin America|United States|USA)\b/i;
const guardedLocation = /\b(?:hybrid|on[- ]?site|in[- ]person|commut(?:e|ing|able)|office[- ]based|resid(?:e|es|ents?|ency)|relocat(?:e|ion)|time ?zones?|excluding|excluded|except|restrictions?|states?|stateside|locals?|proximity|headquarters|remotely|remote|located|based in|work (?:in|from)|hiring in|hired in|open to candidates in|eligible (?:in|locations?)|metropolitan|geograph(?:y|ic|ical)|only|localit(?:y|ies)|locations?|territor(?:y|ies)|regions?|office|within)\b/i;

export function caylentTemplatePosting(job) {
  return job.title === title && /^https:\/\/job-boards\.greenhouse\.io\/caylent\/jobs\/\d+\/?(?:\?[^#]*)?$/.test(job.url);
}

export function caylentRemoteCandidate(slug, row) {
  if (slug !== 'caylent' || row.company_name !== 'Caylent' || row.title !== title ||
      !/^\d+$/.test(String(row.id)) || row.absolute_url !== 'https://job-boards.greenhouse.io/caylent/jobs/' + row.id ||
      row.location?.name !== 'USA' || row.offices?.length !== 1 || row.offices[0].name !== 'Remote' ||
      row.offices[0].location !== null || row.offices[0].parent_id != null || row.offices[0].child_ids?.length) return null;
  const body = normalize(row.content);
  if (!body.includes(companyPolicy) || !body.includes(travel)) return null;
  // Caylent also marks explicitly onsite jobs Remote in both its public feeds.
  // Exclude known non-restrictive boilerplate before looking for role overrides.
  const remainder = body.replace(companyPolicy, '').replace(travel, '').replace('Equipment & Office Stipend', '')
    .replace('it will only be in accordance with applicable laws and regulations', '')
    .replace('current legal authorization to work in the country where this position is located', '');
  if (guardedLocation.test(remainder) || geography.test(remainder)) return null;
  return {country: 'USA', description: body, sourceUrl: 'https://caylent.com/careers/' + row.id};
}

export async function verifyCaylentRemote(row, candidate, fetcher) {
  const response = await fetcher(candidate.sourceUrl, {redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!response.ok) return false;
  const html = await response.text();
  const jobs = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(match => JSON.parse(match[1])).filter(entry => entry?.['@type'] === 'JobPosting');
  if (jobs.length !== 1) return false;
  const job = jobs[0];
  return job.url === candidate.sourceUrl && job.title === row.title && job.identifier?.name === 'Caylent' &&
    job.identifier.value === String(row.id) && job.hiringOrganization?.sameAs === 'https://caylent.com' &&
    job.jobLocationType === 'TELECOMMUTE' && job.applicantLocationRequirements?.['@type'] === 'Country' &&
    job.applicantLocationRequirements.name === candidate.country && normalize(job.description) === candidate.description;
}

export function caylentRenderedLocation(country, rendered, evidence) {
  return country === evidence.country && normalize(rendered) === evidence.description
    ? 'Remote, United States' : 'Location restrictions require review';
}

export function caylentAnnualBase(content) {
  // Match the whole published US salary paragraph. The separate incentives paragraph
  // contains no dollars. Another geographic/OTE band or qualified amount is ambiguous.
  const lines = htmlText(htmlText(content)).split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim());
  const money = lines.filter(line => /\$\s*[\d,]+/.test(line));
  if (money.length !== 1) return null;
  const match = /^Base Salary Range: The expected base salary range for this position is \$(\d{1,3}(?:,\d{3})+)\s*[-–—]\s*\$(\d{1,3}(?:,\d{3})+) per year, commensurate with experience and qualifications\.$/.exec(money[0]);
  if (!match) return null;
  const [min, max] = match.slice(1).map(n => Number(n.replaceAll(',', '')));
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1000 || min > max) return null;
  return {min, max, currency: 'USD', interval: 'year', evidence: money[0]};
}
