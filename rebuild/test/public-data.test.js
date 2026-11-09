import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectEntry} from '../../scripts/check-public-data.mjs';
test('publication guard blocks applicant snapshots, credentials and attachments',()=>{
 for(const file of ['rebuild/private/history.json','data/search.json','documents/resume.pdf','.env','elsewhere/resume.docx']) assert.ok(inspectEntry(file,'{}').length,file);
 assert.ok(inspectEntry('src/accident.js','ghp_'+'a'.repeat(40)).includes('credential pattern'));
 assert.ok(inspectEntry('notes.md','Example Applicant',['Example Applicant']).includes('matches local applicant identity'));
});
test('generic examples and normal source remain publishable',()=>{
 for(const file of ['.env.example','data/search.example.json','applications/example.csv','rebuild/src/core.js']) assert.deepEqual(inspectEntry(file,'generic example'),[]);
});

test('publication guard recognizes additional provider keys and connection credentials without printing them',()=>{
 for(const value of ['sk-ant-'+'a'.repeat(40),'sk_live_'+'a'.repeat(30),'xoxb-'+'1'.repeat(30),'AIza'+'a'.repeat(35)])assert.ok(inspectEntry('notes.md',value).includes('credential pattern'));
 assert.ok(inspectEntry('notes.md','postgresql://'+'user:'+ 'a'.repeat(12)+'@example.invalid/db').includes('connection credential pattern'));
});
