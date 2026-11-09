#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const input=process.argv[2];
if (!input) { console.error('Usage: npm run setup-applicant -- /path/to/your-resume.pdf'); process.exit(2); }
const source=path.resolve(input);
if (!fs.existsSync(source) || !fs.statSync(source).isFile() || path.extname(source).toLowerCase()!=='.pdf') { console.error('Provide an existing PDF résumé.'); process.exit(2); }
const target=path.join(root,'documents','resume.pdf');
if (fs.existsSync(target)) { console.error('documents/resume.pdf already exists; preserve it and choose how to replace it manually.'); process.exit(2); }
fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL); fs.chmodSync(target,0o600);
const search=path.join(root,'data','search.json');
if (!fs.existsSync(search)) { fs.copyFileSync(path.join(root,'data','search.example.json'),search,fs.constants.COPYFILE_EXCL); fs.chmodSync(search,0o600); }
const draft=path.join(root,'data','profile.draft.json');
if (!fs.existsSync(draft)) {
  const p={name:{first:null,last:null},email:null,phone:{national:null,countryCode:null},address:{line1:null,city:null,region:null,regionCode:null,postalCode:null,country:null,countryCode:null},links:{linkedin:null,github:null},education:[],experience:[],projects:[],skills:{languages:[],frameworks:[],tools:[]},spokenLanguages:[],workAuthorization:{citizenships:[],authorizedCountries:[],requiresSponsorshipElsewhere:null,statement:null},demographics:{gender:null,ethnicity:null,hispanicOrLatino:null,veteran:null,disability:null,sexualOrientation:null,transgender:null},preferences:{earliestStart:'',availability:'',salaryExpectation:'',willingToRelocate:null,remote:null,preferredLocations:[],howDidYouHear:'',references:'skip',coverLetter:'never'},resume:{path:target,filename:'resume.pdf'},summary:'',facts:[],answers:[]};
  fs.writeFileSync(draft,JSON.stringify(p,null,2)+'\n',{mode:0o600,flag:'wx'});
}
console.log('Copied your résumé into private local storage.');
console.log('Edit data/profile.draft.json and data/search.json with verified details. Once complete, move the draft to data/profile.json and run npm run doctor.');
console.log('No applications or job searches were started.');
