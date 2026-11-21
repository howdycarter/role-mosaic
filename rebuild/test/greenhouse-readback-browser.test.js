import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';

test('React Select readback preserves employer terms and reuses committed selections on a resumed form', {
 skip:process.env.MOSAIC_BROWSER_TESTS!=='1',
},async t=>{
 const {chromium}=await import('playwright');
 const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-select-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
 t.after(()=>browser.close());
 const context=await browser.newContext();
 const job={id:'test',title:'Director of Engineering',url:'https://job-boards.greenhouse.io/example/jobs/12345',location:'Remote, United States'};
 const policy='Review the candidate privacy policy.';
 const fixture=`<main><h1>Director of Engineering</h1><p>Remote, United States</p><h2>Apply for this job</h2>
 <div class="application-field"><label for="question_1">Choose a response*</label>
 <div class="select-container">
 <span id="react-select-1-live-region" role="status"></span>
 <div class="select__control" onclick="this.dataset.opens=Number(this.dataset.opens||0)+1">
 <span id="react-select-1-placeholder">Select...</span>
 <input id="question_1" role="combobox" aria-describedby="react-select-1-placeholder instructions external-status"></div>
 </div><p id="instructions"><a href="https://example.invalid/policy">Review the candidate privacy policy.</a></p>
 <span id="external-status" role="status">A selection is required.</span></div>
 <label for="resume">Resume</label><input type="file" id="resume"><span id="file"></span><button>Submit application</button></main>`;
 await context.route('**/*',route=>route.request().url()===job.url
  ? route.fulfill({contentType:'text/html',body:fixture}) : route.abort());
 const page=await context.newPage();await page.goto(job.url);
 const adapter=new PlaywrightApplicationAdapter(context,{home,evidenceLoader:async()=>null});
 const responseOf=inspection=>inspection.form.fields.find(field=>field.id==='question_1');
 const pre=await adapter.inspect(job);
 assert.equal(responseOf(pre).description,policy+' A selection is required.');
 assert.equal(responseOf(pre).legacyDescription,'Select... '+policy+' A selection is required.');
 assert.deepEqual(responseOf(pre).policyLinks,['https://example.invalid/policy']);
 assert.equal(responseOf(pre).committedChoices,0);
 await page.evaluate(()=>{
  const combo=document.querySelector('[role="combobox"]'),control=combo.parentElement;
  document.getElementById('react-select-1-placeholder').remove();
  const chip=document.createElement('span');chip.className='select__multi-value__label';chip.textContent='Decline to answer';control.prepend(chip);
  combo.value='uncommitted search';
  document.querySelector('[role="status"]').textContent='Decline to answer is selected. Press Backspace to remove.';
  combo.setAttribute('aria-describedby','react-select-1-live-region instructions external-status');
  document.getElementById('resume').onchange=e=>document.getElementById('file').textContent=e.target.files[0].name;
 });
 const after=await adapter.inspect(job,{tabId:pre.tabId}),field=responseOf(after);
 assert.equal(field.description,responseOf(pre).description);assert.deepEqual(field.policyLinks,responseOf(pre).policyLinks);
 assert.equal(field.value,'Decline to answer');assert.equal(field.committedChoices,1);
 const resume=path.join(home,'sample.pdf');await writeFile(resume,'%PDF-1.4 synthetic');
 const actions=[{field,value:'Decline to answer'}];await adapter.fill(after,actions,resume);
 assert.equal(await page.locator('.select__control').getAttribute('data-opens'),null);
 assert.deepEqual(await adapter.verify(after,actions,resume),{ok:true});
 await page.evaluate(()=>{
  const chip=document.querySelector('.select__multi-value__label'),next=chip.cloneNode(true);
  next.textContent='Another option';chip.after(next);
 });
 const extra=await adapter.inspect(job,{tabId:pre.tabId});
 assert.equal(responseOf(extra).committedChoices,2);
 await assert.rejects(adapter.fill(extra,[{field:responseOf(extra),value:'Decline to answer'}],resume),/Multiple existing selections/);
 await page.evaluate(()=>{
  const input=document.getElementById('question_1');
  const label=document.querySelector('.select__multi-value__label');label.className='select__single-value';label.id='react-select-1-single-value';
  document.querySelector('.select__multi-value__label').remove();
  input.setAttribute('aria-describedby','react-select-1-single-value instructions external-status');
  document.getElementById('instructions').textContent='Updated employer terms.';
 });
 const changed=responseOf(await adapter.inspect(job,{tabId:pre.tabId}));
 assert.equal(changed.description,'Updated employer terms. A selection is required.');
 assert.deepEqual(changed.policyLinks||[],[]);
 assert.equal(changed.value,'Decline to answer');
});
