import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ApplicationStore,configureStandingAuthorization,digest,prepareApplications,runApplications} from '../src/applications.js';
import {PlaywrightApplicationAdapter} from '../src/playwright-adapter.js';
import {seedQuality} from './helpers/quality-fixture.js';

test('a covered or disabled final button leaves a resumable draft and its daily submission available',
  {skip:process.env.MOSAIC_BROWSER_TESTS!=='1',timeout:45000},async t=>{
    const home=await mkdtemp(path.join(os.tmpdir(),'mosaic-button-trial-')),store=new ApplicationStore(home);
    t.after(()=>rm(home,{recursive:true,force:true}));
    const titles=['Director of Product, Customer Experience','Director of Product, Platform','Director of Product, Data'];
    const jobs=titles.map((title,i)=>({id:'job-'+i,company:'Example',title,location:'Remote US',
      url:'https://job-boards.greenhouse.io/example/jobs/'+(810+i)}));
    const pdf='%PDF-1.4 Synthetic resume',resume=path.join(home,'synthetic.pdf');await writeFile(resume,pdf);
    const profile={verified:true,facts:{fullName:'Example Applicant',email:'person@example.invalid',stateCode:'TX'}};
    await store.write('application-profile.json',profile);await store.write('connections.json',{resume});
    await store.write('history.json',[]);await store.write('jobs.json',jobs);
    await store.write('application-policy.json',{enabled:true,maxPerDay:1,dailyBudgetUsd:1,timezone:'America/Chicago',verifiedProfileSha256:digest(profile)});
    await store.write('search.json',{titleLevels:['director'],titleFields:['product'],localCities:[],minAnnualBaseUsd:190000});
    for(const job of jobs)await seedQuality(home,job,resume);
    await configureStandingAuthorization({home,evidence:'Synthetic automatic submissions up to one per day',
      activate:{acknowledgeAutomationRisk:true,track:'product',resumeSha256:digest(pdf)}});
    const {chromium}=await import('playwright');
    const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined,chromiumSandbox:true});
    t.after(()=>browser.close());const context=await browser.newContext({serviceWorkers:'block'}),requests=[];
    await context.route('**/*',async route=>{
      const url=route.request().url(),index=jobs.findIndex(job=>job.url===url);requests.push([route.request().method(),url]);
      if(index<0 || route.request().method()!=='GET')return route.abort();
      const overlay=index===0?'<samp style="position:absolute;inset:0;z-index:2" data-private-detail="unprinted-private-content">Banner</samp>':'';
      await route.fulfill({contentType:'text/html',body:'<h1>'+jobs[index].title+'</h1><p>Remote - United States</p>'+
        '<p>Annual base salary $200,000 - $250,000 USD per year</p><h2>Apply for this job</h2>'+
        '<form><label for="full">Name*</label><input required id="full"><label for="resume">Resume</label><input type="file" id="resume">'+
        '<span id="filename"></span><div style="position:relative;width:fit-content"><button '+(index===1?'disabled':'')+' id="final">Submit application</button>'+
        overlay+'</div></form><script>window.finalClicks=0;resume.onchange=()=>filename.textContent=resume.files[0].name;'+
        'final.onclick=()=>window.finalClicks++;document.forms[0].onsubmit=e=>{e.preventDefault();document.body.textContent="Received a response without a receipt";}</script>'});
    });
    const adapter=new PlaywrightApplicationAdapter(context,{home,evidenceLoader:async()=>null});
    const confirm=adapter.confirm.bind(adapter);
    adapter.confirm=inspection=>confirm(inspection,{waitMs:0});
    const results=[];
    for(const job of jobs){
      const prepared=await prepareApplications({home,adapter,jobIds:[job.id]});
      assert.equal(prepared.packets.length,1,JSON.stringify(prepared.held));
      const [row]=await runApplications({home,adapter,packetIds:[prepared.packets[0].id]});
      results.push(row);
    }
    assert.deepEqual(results.map(r=>r.status),['held','held','submission_unknown']);
    for(const [index,code] of ['covered','disabled'].entries()){
      const row=results[index];assert.equal(row.finalActionAt,undefined);assert.equal(row.finalButtonCheck.code,code);
      assert.equal(row.reason.includes('unprinted-private-content'),false);
      assert.equal(await adapter.preservedPage(row).evaluate(()=>window.finalClicks),0);
    }
    assert.ok(results[2].finalActionAt);assert.equal(await adapter.preservedPage(results[2]).evaluate(()=>window.finalClicks),1);
    assert.equal((await store.read('history.json',[])).length,0);
    assert.deepEqual(await runApplications({home,adapter,resumeAttemptId:results[2].id}),[]);
    assert.deepEqual(requests,jobs.map(j=>['GET',j.url]));
});
