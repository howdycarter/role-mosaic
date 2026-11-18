const country = /^(?:us|usa|united states(?: of america)?)$/i;

function normalized(label) {
  return String(label || '').toLowerCase().replace(/\./g, '').replace(/[-_,():–—]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Match the whole location label. "Remote US (California only)" is a
// different eligibility claim from "Remote US".
export function nationwideUSRemote(label) {
  const words = normalized(label).replace(/^location\s+/, '');
  const remoteFirst = words.match(/^(?:(?:fully|100%) )?remote (?:in (?:the )?)?(.+?)(?: only| nationwide)?$/);
  const countryFirst = words.match(/^(.+?)(?: only| nationwide)? (?:(?:fully|100%) )?remote(?: only)?$/);
  return Boolean((remoteFirst && country.test(remoteFirst[1])) || (countryFirst && country.test(countryFirst[1])));
}

export function qualifiedUSRemote(label) {
  const words = normalized(label).replace(/^location /, '');
  return /^(?:remote (?:in the )?(?:us|usa|united states)\b|(?:us|usa|united states) remote\b)/.test(words) && !nationwideUSRemote(label);
}

export function requiresLocalResidence(text) {
  const statements = String(text).split(/\r?\n|(?<=[.!?])\s+/);
  return statements.some(statement => {
    const requirement = statement.trim().match(/^(?:[-*•]\s*)?(?:candidates?|applicants?|you|this (?:role|position)|the successful candidate)\s+(?:must|need to|will need to|(?:is|are) required to)\s+(?:(?:currently|already)\s+)?(?:live|reside|be (?:based|located)|relocate)\s+(?:in|within|near|to)\s+(.+)/i);
    if (!requirement) return false;
    const geography = normalized(requirement[1]).replace(/^the /, '').replace(/ to (?:apply|be (?:eligible|considered))$/, '');
    return !country.test(geography);
  });
}

export function ashbyLocation(job) {
  const workplace = job.workplaceType;
  const canBeRemote = workplace ? workplace === 'Remote' : job.isRemote === true;
  const options = [{location: job.location, address: job.address?.postalAddress}, ...(job.secondaryLocations || [])];
  const labels = options.map(({location = '', address = {}}) => {
    const label = location.trim();
    const locality = [address?.addressLocality, address?.addressRegion].filter(Boolean).join(', ');
    const addressCountry = address?.addressCountry || '';
    const generic = !label || normalized(label) === 'remote' || country.test(normalized(label)) || nationwideUSRemote(label);
    // Employers sometimes geocode a "Remote - US" option to an office city.
    // Respect the explicit public label when its country and workplace agree.
    if (canBeRemote && nationwideUSRemote(label) && (!addressCountry || country.test(normalized(addressCountry)))) {
      return 'Remote, United States';
    }
    if (generic && locality) return [locality, addressCountry, workplace].filter(Boolean).join(', ');
    if (!canBeRemote && (workplace || job.isRemote === false)) {
      return [label || addressCountry, workplace || 'remote eligibility unverified'].filter(Boolean).join(', ');
    }
    if (canBeRemote && generic && (!addressCountry || country.test(normalized(addressCountry))) &&
        (country.test(normalized(label)) || nationwideUSRemote(label) || country.test(normalized(addressCountry)))) {
      return 'Remote, United States';
    }
    if (generic && addressCountry && !country.test(normalized(addressCountry))) {
      return [addressCountry, workplace].filter(Boolean).join(', ');
    }
    return label || [locality, addressCountry].filter(Boolean).join(', ');
  });
  if (labels.includes('Remote, United States')) return 'Remote, United States';
  return [...new Set(labels.filter(Boolean))].join(' | ');
}
