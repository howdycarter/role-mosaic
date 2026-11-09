#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const publicData = new Set(['data/accounts.example.json','data/bank.example.json','data/policy.example.json','data/profile.example.json','data/search.example.json','data/template.json','data/voice.md']);
export function inspectEntry(filename, content, applicantValues=[]) {
  const reasons=[];
  const f=filename.replaceAll('\\','/');
  if (/(^|\/)private\//.test(f) || /(^|\/)\.env(?:\.|$)/.test(f) && !f.endsWith('.env.example')) reasons.push('private runtime file');
  if (f.startsWith('data/') && !publicData.has(f)) reasons.push('applicant data');
  if (f.startsWith('documents/') && f !== 'documents/README.md' || f.startsWith('applications/') && !['applications/README.md','applications/example.csv'].includes(f)) reasons.push('applicant document or record');
  if (/\.(pdf|docx?|rtf|pem|p12|pfx|key)$/i.test(f)) reasons.push('document or credential attachment');
  if (/(?:sk-or-v1-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9_-]{30,}|gh[pousr]_[a-zA-Z0-9]{25,}|github_pat_[a-zA-Z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(content)) reasons.push('credential pattern');
  if (/(?:\/Users\/|\/home\/)[a-zA-Z0-9_.-]+\//.test(content)) reasons.push('personal home-folder path');
  const lower=content.toLowerCase();
  if (applicantValues.some(v=>v.length>=8 && lower.includes(v.toLowerCase()))) reasons.push('matches local applicant identity');
  return reasons;
}
export function localApplicantValues(root) {
  const file=path.join(root,'data/profile.json');
  if (!existsSync(file)) return [];
  const p=JSON.parse(readFileSync(file,'utf8'));
  return [p.name?.first && p.name?.last ? `${p.name.first} ${p.name.last}` : '',p.email,p.phone?.national,p.address?.line1,p.links?.linkedin].filter(v=>typeof v==='string' && v.length>=8);
}
export function auditRepository(root,ref) {
  const git=(args)=>execFileSync('git',['-C',root,...args],{maxBuffer:32*1024*1024});
  const files=git(ref?['ls-tree','-rz','--name-only',ref]:['ls-files','-z']).toString().split('\0').filter(Boolean);
  const values=localApplicantValues(root), findings=[];
  for(const file of files){
    if (!ref && !existsSync(path.join(root,file))) continue;
    const content=(ref?git(['show',`${ref}:${file}`]):readFileSync(path.join(root,file))).toString('utf8');
    const reasons=inspectEntry(file,content,values);
    if(reasons.length) findings.push({file,reasons});
  }
  return {filesChecked:files.length,findings};
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(args.length && (args.length!==2 || args[0]!=='--ref')) throw Error('Usage: check-public-data.mjs [--ref COMMIT]');
    const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
    const result=auditRepository(root,args[1]);
    for(const finding of result.findings) console.error(`${finding.file}: ${finding.reasons.join(', ')}`);
    console.log(`Public-data check: ${result.filesChecked} tracked files; ${result.findings.length} findings. No matched values are printed.`);
    if(result.findings.length) process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
