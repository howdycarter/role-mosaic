import { describe, expect, it } from 'vitest';
import { leadershipLocation, leadershipTitle, compensationEvidence } from '../src/jobs/leadership.js';
import type { SearchConfig } from '../src/jobs/searchConfig.js';
const criteria: SearchConfig = { titleLevels:['director','staff','principal','vp','head'], titleFields:['product','design','engineer','engineering','ux','research'], localCities:['Portland'], remoteCountry:'United States', minAnnualBaseUsd:190000 };

describe('configurable search criteria', () => {
  it('matches configured titles and holds unrelated or junior titles', () => {
    for (const title of ['VP of Product', 'Director of Product Design', 'Staff Product Manager', 'Principal UX Researcher', 'Head of Design', 'Staff Software Engineer']) expect(leadershipTitle(title,criteria)).toBe(true);
    for (const title of ['Product Design Intern', 'Senior Product Designer', 'Director of Sales']) expect(leadershipTitle(title,criteria)).toBe(false);
  });
  it('uses the configured cities and requires explicit US-wide remote', () => {
    for (const place of ['Portland, OR','Remote - United States','Remote, USA']) expect(leadershipLocation([place],criteria)).toBe(true);
    for (const place of ['Remote','Remote - Canada','Remote - US, hybrid','Remote - US San Francisco Bay Area','New York, NY','']) expect(leadershipLocation([place],criteria)).toBe(false);
  });
  it('requires an explicit annual base floor', () => {
    expect(compensationEvidence('Base salary: $200,000 - $250,000 per year',criteria)).toBe(true);
    for (const value of ['Base salary: $180,000 - $250,000 per year','Total compensation includes equity','Base pay: $200 per hour','Base salary: $200,000 per hour','Base salary: $200,000']) expect(compensationEvidence(value,criteria)).toBe(false);
    expect(compensationEvidence('Annual base salary: $200,000',criteria)).toBe(true);
  });
});
