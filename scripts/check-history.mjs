#!/usr/bin/env node
// Read-only comparison against the imported history snapshot; ambiguous matches require review.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const file = path.resolve('data/history/applications.json');
const [company='', ...roleParts] = process.argv.slice(2);
const role = roleParts.join(' ');
if (!company || !role) { console.error('Usage: node scripts/check-history.mjs "Company" "Job title"'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('History snapshot missing; do not submit.'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(data.applications) || !data.applications.length) { console.error('History snapshot invalid; do not submit.'); process.exit(2); }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const matches = data.applications.filter(x => norm(x.company) === norm(company) && norm(x.role) === norm(role));
console.log(JSON.stringify({total: data.applications.length, matches: matches.map(({company,role,status,date,posting})=>({company,role,status,date,posting})), warning:'Snapshot only; confirm against current tracker and review similar titles and company restrictions before applying.'}, null, 2));
