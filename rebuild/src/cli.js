import { researchShortlist } from './shortlist.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { home, read, write } from './store.js';
import { scanBoards, discoveryMessage } from './discovery.js';
import { evaluate, createHistoryLookup } from './core.js';
import { initialize, connectNotion, attachResume, options } from './onboarding.js';
import { importCareer, renderCareer } from './career.js';
import { recordOutcome, summarizeOutcomes } from './outcomes.js';
import { ApplicationStore, approveResume, configureApplications } from './applications.js';
import {prepareQualityPackets,registerTrackResume,initializeQuality,recordRoleReview} from './packets.js';
const [cmd='help',...args] = process.argv.slice(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function main() {
 if(cmd==='quality-init') {console.log(JSON.stringify(await initializeQuality(home)));
 } else if(cmd==='register-resume') {const o=options(args,['track','file','confirm']);console.log(JSON.stringify(await registerTrackResume({home,...o})));
 } else if(cmd==='review-role') {const o=options(args,['job','file','confirm','reviewer']);console.log(JSON.stringify(await recordRoleReview({home,jobId:o.job,file:o.file,confirm:o.confirm,reviewer:o.reviewer})));
 } else if(cmd==='prepare-packets') {const o=options(args,['job','limit']);const r=await prepareQualityPackets({home,jobIds:o.job?[o.job]:undefined,limit:Number(o.limit||15)});console.log(JSON.stringify({mode:r.submissionMode,prepared:r.packets.length,ready:r.packets.filter(p=>p.quality.ready).length,directory:path.join(home,'packets'),issues:r.evidenceIssues}));
 } else if(cmd==='init') {
  const result=await initialize(options(args,['resume','career','search','boards','profile']));
  console.log(`Applicant workspace created at ${result.home}. ${result.boards} boards configured. Review search.json and career-review.html in that workspace before discovery. No AI calls or applications were made.`);
 } else if(cmd==='approve-resume') {
  const result=await approveResume({home,...options(args,['confirm'])});console.log('Exact external PDF approved: '+result.sha256);
 } else if(cmd==='configure-applications') {
  const o=options(args,['profile','max-per-day','daily-budget','timezone','confirm']);
  if(!o.profile)throw Error('Provide --profile FILE with your verified application facts');
  const result=await configureApplications({home,profileFile:o.profile,maxPerDay:Number(o['max-per-day']||15),dailyBudgetUsd:Number(o['daily-budget']||1),timezone:o.timezone||'America/Chicago',confirm:o.confirm});console.log('Application policy configured: '+JSON.stringify(result)+'. Prepare and authorize exact packets through the connected Browser.');
 } else if(cmd==='import-career') {
  const result=await importCareer(options(args,['file','label']));
  console.log(`Career sources: ${result.sources}; structured roles: ${result.roles}. ${result.duplicate?'Duplicate skipped. ':''}Review career-review.html and edit career-notes.md. Nothing is approved or submitted.`);
 } else if(cmd==='career-review') {
  const history=await read('career-history.json',null); if(!history) throw Error('Initialize your workspace first');
  await renderCareer(history); console.log(`Private review: ${path.join(home,'career-review.html')}`);
 } else if(cmd==='attach-resume') {
  await attachResume(options(args,['file'])); console.log('Private PDF attached. Attachment is not approval or submission.');
 } else if(cmd==='connect-notion') {
  await connectNotion(options(args,['file','url','title']));
  console.log('Private Notion career-history snapshot saved. This is not automatic synchronization or resume approval.');
 } else if(cmd==='import-legacy') {
  const root=path.resolve(args[0]||'..');
  const search=JSON.parse(await readFile(path.join(root,'data/search.json'),'utf8'));
  const history=JSON.parse(await readFile(path.join(root,'data/history/applications.json'),'utf8'));
  if(!Array.isArray(search.titleLevels)||!Array.isArray(search.titleFields)||!Array.isArray(search.localCities)||!Array.isArray(history.applications)) throw Error('Invalid legacy search or history');
  if(await read('search.json',null)||await read('history.json',null)) throw Error('Import refused: existing search or history');
  await write('search.json',search); await write('history.json',history.applications);
  await write('connections.json',{profile:path.join(root,'data/profile.json'),resume:path.join(root,'documents/resume.pdf'),boards:[]});
  console.log(`Imported search and ${history.applications.length} history entries. Profile and résumé paths are local references. Add boards to ${home}/connections.json.`);
 } else if(cmd==='discover') {
  const config=await read('search.json',null);if(!config)throw Error('Configure search settings first.');
  const result=await scanBoards({store:new ApplicationStore(home)});
  console.log(discoveryMessage(result));
  for(const failure of result.failures)console.error(failure.source+': '+failure.reason);
  if(result.status==='failed')throw Error('All sources failed; saved jobs unchanged.');
  const jobs=await read('jobs.json',[]),history=await read('history.json',[]);
  const lookup=createHistoryLookup(history);
  const matches=jobs.filter(job=>job.listingState!=='unlisted'&&evaluate(job,config).disposition==='match'&&!lookup(job));
  console.log(matches.length+' matches without a known history match.');
 } else if(cmd==='report') {
  const config=await read('search.json',null); if(!config) throw Error('Missing search settings');
  const jobs=await read('jobs.json',[]), history=await read('history.json',[]);
  const lookup=createHistoryLookup(history);
  const sorted=jobs.map(j=>({...j,fit:evaluate(j,config),previous:lookup(j)})).sort((a,b)=>b.fit.score-a.fit.score);
  const cards=sorted.map(j=>`<article><h2>${esc(j.title)}</h2><p>${esc(j.company)} · ${esc(j.location)}</p><p><strong>${j.fit.score}/100</strong> · ${esc(j.status)}${j.previous?' · Possible previous application':''}</p><p>${esc(j.fit.reasons.join('; ')||'Title and location match')} · ${esc(j.source)}</p>${/^https:\/\//i.test(j.url)?`<a href="${esc(j.url)}" rel="noreferrer">Open employer posting</a>`:'Posting URL needs review'}</article>`).join('');
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>RoleMosaic report</title><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;max-width:900px;margin:3rem auto;padding:0 1rem;color:#182538;background:#f6f8fb}article{background:white;border:1px solid #dae1eb;border-radius:12px;padding:1rem 1.5rem;margin:1rem 0}h2{font-size:1.2rem}a{color:#1454b8}</style><h1>RoleMosaic</h1><p>${sorted.length} saved listings. Verify posting, compensation and history; listings may have closed.</p>${cards||'<p>No listings yet.</p>'}</html>`;
  const file=path.join(home,'report.html'); await writeFile(file,html,{mode:0o600}); console.log(`Report: ${file}`);
 } else if(cmd==='shortlist') {
  const opts=options(args,['track','limit']);
  const [jobs,search,history,ledger]=await Promise.all([read('jobs.json',[]),read('search.json',{}),read('history.json',[]),read('application-ledger.json',[])]);
  console.log(JSON.stringify(await researchShortlist({jobs,search,history,ledger,track:opts.track,limit:Number(opts.limit??10)}),null,2));
 } else if(cmd==='record-outcome') {
  const opts=options(args,['attempt','stage','date','reference','attribution']);
  console.log(JSON.stringify(await recordOutcome(home,opts),null,2));
 } else if(cmd==='outcomes') {
  const opts=options(args,['resume-sha256']);
  if(opts['resume-sha256']&&!/^[a-f0-9]{64}$/.test(opts['resume-sha256']))throw Error('Provide a full SHA-256 résumé digest');
  const [ledger,events]=await Promise.all([read('application-ledger.json',[]),read('application-outcomes.json',[])]);
  console.log(JSON.stringify(summarizeOutcomes(ledger,events,{resumeSha256:opts['resume-sha256']}),null,2));
 } else if(cmd==='applications') {
  const ledger=await read('application-ledger.json',[]),plan=await read('application-plan.json',{packets:[],held:[]});
  const totals=summarizeOutcomes(ledger,[]);
  console.log(JSON.stringify({prepared:plan.packets.length,heldBeforeFill:plan.held.length,submitted:totals.confirmed,unknown:totals.unresolved,unverifiedSubmitted:totals.unverifiedSubmitted,held:ledger.filter(a=>a.status==='held').length},null,2));
 } else if(cmd==='status') {
  const [jobs,history,c]=await Promise.all([read('jobs.json',[]),read('history.json',[]),read('connections.json',null)]);
  console.log(`${jobs.length} saved jobs, ${history.length} imported history entries, ${c?.boards?.length||0} boards. Browser application packets, authorization and receipts: npm start -- applications. Live execution requires the connected Codex Browser driver.`);
 } else if(cmd==='list') {
  for(const j of await read('jobs.json',[])) console.log(`${j.id} | ${j.status} | ${j.company} | ${j.title} | ${j.location}`);
 } else if(cmd==='mark') {
  const [id,status,...note]=args, valid=['new','saved','dismissed','applied','interview','rejected','offer'];
  if(!valid.includes(status)) throw Error(`Status must be one of ${valid.join(', ')}`);
  await new ApplicationStore(home).lock(async()=>{
  const jobs=await read('jobs.json',[]), matches=jobs.filter(j=>j.id.startsWith(id||''));
  if(!id||matches.length!==1) throw Error('Provide a unique job ID prefix');
  matches[0].status=status; if(note.length) matches[0].note=note.join(' '); matches[0].updatedAt=new Date().toISOString(); await write('jobs.json',jobs); console.log(`Updated ${id} to ${status}.`);
  });
 } else console.log('RoleMosaic rebuild: quality-init, review-role --job ID --file REVIEW_JSON --reviewer NAME --confirm reviewed, register-resume --track product|design|engineering|fde --file PDF [--confirm reviewed], prepare-packets [--job ID] [--limit 15], init [--resume PDF | --career FILE] [--search FILE] [--boards FILE] [--profile FILE], import-career --file FILE [--label NAME], career-review, approve-resume --confirm reviewed, configure-applications --profile FILE --confirm reviewed, attach-resume --file PDF, connect-notion --file FILE --url URL, import-legacy [path], discover, report, list, mark ID STATUS [NOTE], applications, shortlist --track TRACK [--limit N], outcomes [--resume-sha256 DIGEST], record-outcome --attempt ID --stage STAGE --date YYYY-MM-DD --reference SOURCE, status');
}
main().catch(e=>{console.error(`Error: ${e.message}`); process.exitCode=1;});
