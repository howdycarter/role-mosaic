import { loadSearchConfig, type SearchConfig } from './searchConfig.js';

const includesTerm = (text: string, terms: string[]) => terms.some(term => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text);
});
/** Preliminary discovery only; a title or location match does not authorize submission. */
export function leadershipTitle(title: string, config: SearchConfig = loadSearchConfig()): boolean {
  return includesTerm(title, config.titleLevels) && includesTerm(title, config.titleFields)
    && !/\b(intern|internship|unpaid)\b/i.test(title);
}
export function leadershipLocation(locations: string[], config: SearchConfig = loadSearchConfig()): boolean {
  return locations.some((raw) => {
    const text = raw.trim();
    if (/\b(except|excluding|not available|outside)\b/i.test(text)) return false;
    if (includesTerm(text, config.localCities)) return true;
    return /\bremote\b/i.test(text)
      && /\b(united states|u\.?s\.?a?\.?|nationwide|anywhere in the us)\b/i.test(text)
      && !/\b(canada|emea|europe|uk|united kingdom|hybrid|on.?site|san francisco|bay area|new york|chicago)\b/i.test(text);
  });
}
/** Only explicit annual USD base salary can pass; ambiguous total packages need review. */
export function compensationEvidence(description: string, config: SearchConfig = loadSearchConfig()): boolean {
  const re = /(?:annual\s+)?base\s+(?:salary|pay|compensation)[^\n.]{0,70}?\$\s*([\d,]+)(?:\s*(?:-|–|—|to)\s*\$\s*[\d,]+)?/ig;
  for (const match of description.matchAll(re)) {
    const amount = Number(match[1]?.replaceAll(',', ''));
    const context = description.slice(Math.max(0, (match.index ?? 0) - 15), (match.index ?? 0) + match[0].length + 35);
    if (amount >= config.minAnnualBaseUsd && amount < 2000000 && /\b(annual|annually|per year|yearly|a year)\b/i.test(context) && !/\b(hour|hourly|month|monthly|week|weekly)\b/i.test(context)) return true;
  }
  return false;
}
