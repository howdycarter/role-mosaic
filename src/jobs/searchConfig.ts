import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PATHS } from '../config.js';

export const SearchConfig = z.object({
  titleLevels: z.array(z.string().min(1)).min(1),
  titleFields: z.array(z.string().min(1)).min(1),
  localCities: z.array(z.string().min(1)),
  remoteCountry: z.literal('United States'),
  minAnnualBaseUsd: z.number().positive(),
});
export type SearchConfig = z.infer<typeof SearchConfig>;
export function loadSearchConfig(file = path.join(PATHS.data, 'search.json')): SearchConfig {
  if (!existsSync(file)) throw new Error('Missing data/search.json. Copy data/search.example.json and set your own criteria.');
  return SearchConfig.parse(JSON.parse(readFileSync(file, 'utf8')));
}
