import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProfileSchema } from '../src/profile/schema.js';
import { valueFor, yearsOfExperience, profileFacts } from '../src/profile/fieldKeys.js';
const example = JSON.parse(readFileSync('data/profile.example.json','utf8'));
describe('partial candidate facts', () => {
  it('holds unknown education dates, demographics and sponsorship facts', () => {
    const x = structuredClone(example);
    delete x.education[0].startMonth; delete x.education[0].startYear;
    x.demographics.veteran = null; x.workAuthorization.requiresSponsorshipElsewhere = null;
    const p = ProfileSchema.parse(x);
    expect(valueFor(p,'education_start_date')).toBeNull();
    expect(valueFor(p,'veteran_status')).toBeNull();
    expect(profileFacts(p)).not.toHaveProperty('requires_sponsorship_outside_authorized_countries');
  });
  it('does not add overlapping work periods twice', () => {
    const x = structuredClone(example);
    x.experience = [
      {...x.experience[0], start:'2020-01', end:'2022-01', current:false},
      {...x.experience[0], start:'2021-01', end:'2023-01', current:false}
    ];
    expect(yearsOfExperience(ProfileSchema.parse(x))).toBe(3);
  });
});
