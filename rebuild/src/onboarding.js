import { readFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { home, write } from './store.js';

export const starterSearch = {
  titleLevels: ['director', 'vp', 'head'],
  titleFields: ['product', 'engineering', 'design'],
  localCities: [], remoteCountry: 'United States', minAnnualBaseUsd: null,
  excludeEmployers: [], targetTracks: ['product', 'engineering', 'design'],
};
export function options(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || key in result) throw Error('Invalid or repeated setup option');
    result[key] = args[i + 1];
  }
  return result;
}
export function validateSearch(search) {
  for (const key of ['titleLevels', 'titleFields', 'localCities']) {
    if (!Array.isArray(search[key]) || search[key].some(v => typeof v !== 'string' || !v.trim())) throw Error(`Search ${key} must be a list of nonempty strings`);
  }
  if (!search.titleLevels.length || !search.titleFields.length) throw Error('Choose at least one title level and field');
  if (search.minAnnualBaseUsd !== null && (!Number.isFinite(search.minAnnualBaseUsd) || search.minAnnualBaseUsd < 0)) throw Error('Salary floor must be a nonnegative annual USD amount or null');
  if (search.remoteCountry !== 'United States') throw Error('Remote screening currently supports United States only');
  if (search.excludeEmployers !== undefined && (!Array.isArray(search.excludeEmployers) || search.excludeEmployers.some(v => typeof v !== 'string' || !v.trim()))) throw Error('Excluded employers must be a list of nonempty strings');
  return search;
}
export function validateBoards(boards) {
  if (!Array.isArray(boards) || boards.some(b => !['greenhouse','lever','ashby'].includes(b.type) || !/^[a-zA-Z0-9_-]+$/.test(b.slug || '') || typeof b.company !== 'string' || !b.company.trim())) throw Error('Boards must contain valid type, slug and company values');
  return boards;
}
async function jsonFile(file) { return JSON.parse(await readFile(path.resolve(file), 'utf8')); }
export async function initialize(opts) {
  if (!opts.resume) throw Error('Usage: init --resume /path/to/resume.pdf [--search rules.json] [--boards boards.json] [--profile profile.json]');
  try { if ((await readdir(home)).length) throw Error('Setup refused: applicant files already exist; use another ROLEMOSAIC_HOME to preserve them'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const source = path.resolve(opts.resume), pdf = await readFile(source);
  if (path.extname(source).toLowerCase() !== '.pdf' || pdf.subarray(0,5).toString() !== '%PDF-') throw Error('Provide a PDF resume file');
  const search = validateSearch(opts.search ? await jsonFile(opts.search) : structuredClone(starterSearch));
  const boards = validateBoards(opts.boards ? await jsonFile(opts.boards) : []);
  const profile = opts.profile ? await jsonFile(opts.profile) : null;
  if (profile !== null && (typeof profile !== 'object' || Array.isArray(profile))) throw Error('Profile must be a JSON object of your own verified facts');
  await mkdir(home,{recursive:true,mode:0o700});
  const resume = path.join(home,'resume.pdf');
  await copyFile(source,resume,constants.COPYFILE_EXCL);
  const { chmod } = await import('node:fs/promises'); await chmod(resume,0o600);
  await write('search.json',search); await write('history.json',[]);
  if (profile) await write('profile.json',profile);
  await write('connections.json',{resume,profile:profile ? path.join(home,'profile.json') : null,boards});
  return {home,boards:boards.length};
}
export async function connectNotion(opts) {
  if (!opts.file || !opts.url) throw Error('Usage: connect-notion --file career.md --url https://www.notion.so/your-page');
  const url = new URL(opts.url), hostname = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || !['notion.so','notion.site','app.notion.com'].some(h => hostname === h || (h !== 'app.notion.com' && hostname.endsWith('.'+h)))) throw Error('Use the HTTPS URL of your Notion page');
  const text = await readFile(path.resolve(opts.file),'utf8');
  if (!text.trim() || Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error('Notion snapshot must contain text and be at most 2 MiB');
  await write('notion-resume.json',{url:url.href,title:opts.title || 'Career history',text,syncedAt:new Date().toISOString(),approved:false});
}
