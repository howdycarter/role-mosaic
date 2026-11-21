import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ApplicationStore,digest,fillPlan} from '../src/applications.js';
import {publishedMongoSurvey,observeMongoSurvey,attachMongoSurvey,voluntarySurveyProposal,fillVoluntarySurveyField} from '../src/mongo-voluntary-survey.js';
import {applicationPosting,approvedPostingPermission,observeGreenhouseQuestions,readGreenhouseInbox,readGreenhouseAnswers,decidePostingPermission} from '../src/greenhouse-inbox.js';

const job={id:'example',company:'MongoDB',title:'Synthetic Engineer',url:'https://www.mongodb.com/careers/job/?gh_jid=101'};
const decline="I don't wish to answer";
const description='<p>Voluntary demographic survey. Read the <a href="https://www.mongodb.com/legal/eu-ca-recruitment-privacy-notice">privacy notice</a>.</p>';
const raw={header:'U.S. Voluntary Demographic Survey',description,
  questions:['Gender','Gender Identity','Race','Are you Hispanic/Latino?','Veteran Status','Disability Status'].map((label,i)=>({
    id:101+i,label,type:'multi_value_single_select',required:true,answer_options:[{label:'Example option',free_form:false,decline_to_answer:false},
      {label:decline,free_form:false,decline_to_answer:true}]}))};
const published=publishedMongoSurvey(raw);
const survey={...published,description:'Voluntary demographic survey. Read the privacy notice.',terms:published.consent,
  links:['https://www.mongodb.com/legal/eu-ca-recruitment-privacy-notice']};
const profile={verified:true,facts:{},answers:[{question:'Gender',answer:'Example option',verified:true,scopePostingKey:'greenhouse:999'}]};
function initial(){
  const fields=raw.questions.map(q=>({id:String(q.id),label:q.label+'*',type:'select',required:true,value:'',options:[],committedChoices:0}));
  fields.push({id:published.consentId,label:published.consent+'*',type:'checkbox',required:true,value:'false'});
  const form={fields,resume:{label:'Resume'},submit:{label:'Submit'}};attachMongoSurvey(form,survey);return form;
}
test('requires the entire published survey, literal decline choices, and one unique match per live control',()=>{
  for(const changed of [r=>r.questions.pop(),r=>r.questions[1].id=r.questions[0].id,r=>r.questions[0].required=false,
    r=>r.questions[0].answer_options[1].label='No',r=>r.questions[0].answer_options[1].free_form=true,
    r=>r.questions[0].answer_options[0].decline_to_answer=true,r=>r.description+='<img src="https://example.org/">']){
    const row=structuredClone(raw);changed(row);assert.equal(publishedMongoSurvey(row),null);
  }
  for(const change of [f=>f.fields[0].value='Example option',f=>f.fields.at(-1).value='true',
    f=>f.fields[0].committedChoices=2,f=>f.fields[0].options=['Example option'],f=>f.fields.pop()]){
    const form=initial();change(form);assert.equal(voluntarySurveyProposal({job,posting:applicationPosting(job.url),form,
      missing:form.fields.map(f=>f.label),profile}),null);
  }
});
test('the applicant decides for one form and profile, with every question preserved and no automatic consent',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'mongo-survey-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const store=new ApplicationStore(home);
  await store.write('jobs.json',[job]);await store.write('application-profile.json',profile);
  const form=initial(), missing=fillPlan(form,profile).missing, profileSha256=digest(profile);
  const observe={job,profileSha256,form,missing,store};
  await observeGreenhouseQuestions(observe);
  const [item]=(await readGreenhouseInbox(store)).permissions;
  assert.equal(item.purpose,'decline-voluntary-survey');assert.equal(item.fields.length,7);
  assert.ok(item.fields.at(-1).help.includes(survey.description));assert.deepEqual(item.fields.at(-1).links,survey.links);
  assert.equal((await readGreenhouseAnswers(store)).permissions,undefined);
  const lookup=async(candidate=form)=>approvedPostingPermission(await readGreenhouseAnswers(store),{job,profileSha256,form:candidate});
  assert.equal(await lookup(),null);
  const decide={store,id:item.id,jobId:job.id,revision:item.revision,decision:'allow'};
  await assert.rejects(decidePostingPermission({...decide,revision:'different'}),/changed/);
  assert.deepEqual((await decidePostingPermission(decide)).jobIds,[job.id]);
  const permission=await lookup();
  assert.ok(fillPlan(form,profile,{permission}).actions.every(a=>a.field.surveyChoiceVerified));
  assert.deepEqual(fillPlan(form,profile,{permission}).actions.map(a=>a.value),[...Array(6).fill(decline),'true']);
  const populated=initial();
  populated.fields[0].value=decline;populated.fields[0].committedChoices=1;
  populated.fields.at(-1).value='true';
  assert.ok(await lookup(populated));
  for(const change of [f=>f.fields[2].value='Example option',f=>f.voluntarySurvey={...survey,terms:'Updated terms'},
    f=>f.voluntarySurvey={...survey,links:['https://example.org/new']},f=>delete f.voluntarySurvey]){
    const changed=initial();change(changed);assert.equal(await lookup(changed),null);
  }
  for(const scopePostingKey of [undefined,'greenhouse:101']){
    assert.equal(voluntarySurveyProposal({job,posting:applicationPosting(job.url),form,missing,
      profile:{...profile,answers:[{...profile.answers[0],scopePostingKey}]}}),null);
  }
  assert.deepEqual(await store.read('application-profile.json'),profile);
});
test('the rendered survey binds its published notice and six controls to the separate consent and complete visible legal text',
  {skip:!process.env.MOSAIC_BROWSER_TESTS},async t=>{
    const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
    t.after(()=>browser.close());const page=await browser.newPage();
    const controls=raw.questions.map(q=>'<label for="'+q.id+'">'+q.label+'*</label><select required id="'+q.id+'"><option value=""></option>'+
      q.answer_options.map(o=>'<option>'+o.label+'</option>').join('')+'</select>').join('');
    await page.setContent('<form id="application-form"><div id="demographic-section"><h3>'+raw.header+'</h3><div class="body">'+description+
      '</div>'+controls+'</div><div>Supplemental employer policy: <a href="https://example.org/terms">terms</a></div><label for="'+published.consentId+'">'+
      published.consent+'*</label><input required type="checkbox" id="'+published.consentId+'"><button type="submit">Submit</button></form>');
    const observed=await page.evaluate(observeMongoSurvey,published);
    assert.equal(observed.consent,survey.consent);assert.match(observed.terms,/Supplemental employer policy/);
    assert.deepEqual(observed.links,[...survey.links,'https://example.org/terms']);
    const question=observed.questions[0],control=page.locator('[id="'+question.id+'"]');
    const fields={published,survey:observed,field:{id:question.id,type:'select'},value:decline};
    await control.selectOption({label:'Example option'});
    await assert.rejects(fillVoluntarySurveyField(page,control,fields),/Existing voluntary/);
    assert.equal(await control.inputValue(),'Example option');
    await control.selectOption('');await fillVoluntarySurveyField(page,control,fields);assert.equal(await control.inputValue(),decline);
    await page.locator('#demographic-section .body').evaluate(n=>n.append(' Changed privacy notice.'));
    const checkbox=page.locator('#'+published.consentId);
    await assert.rejects(fillVoluntarySurveyField(page,checkbox,{...fields,field:{id:published.consentId,type:'checkbox',consentVerified:true},value:'true'}),/consent changed/);
    assert.equal(await checkbox.isChecked(),false);
    await page.locator('#demographic-section .body').evaluate(n=>n.lastChild.remove());
    await fillVoluntarySurveyField(page,checkbox,{...fields,field:{id:published.consentId,type:'checkbox',consentVerified:true},value:'true'});
    assert.ok(await checkbox.isChecked());
    // Replace one synthetic select with the live widget's closed-combobox shape.
    await control.evaluate((select,options)=>{
      const widget=document.createElement('div');widget.className='select__control';
      const input=document.createElement('input');input.id=select.id;input.setAttribute('role','combobox');widget.append(input);select.replaceWith(widget);
      widget.onclick=()=>{
        const menu=document.createElement('div');menu.id='choices-'+input.id;menu.setAttribute('role','listbox');input.setAttribute('aria-controls',menu.id);widget.after(menu);
        for(const text of options){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;
          option.onclick=()=>{const result=document.createElement('span');result.className='select__single-value';result.textContent=text;widget.append(result);menu.remove();};menu.append(option);}
      };
    },question.options);
    await fillVoluntarySurveyField(page,control,fields);
    assert.equal(await page.locator('.select__single-value').innerText(),decline);
    const changed=structuredClone(published);changed.description=changed.description.replace('Voluntary','Compulsory');
    assert.equal(await page.evaluate(observeMongoSurvey,changed),null);
    await page.locator('#demographic-section').evaluate(n=>n.insertAdjacentHTML('beforeend','<input id="unknown">'));
    assert.equal(await page.evaluate(observeMongoSurvey,published),null);
  });

test('dashboard offers personal customization, explicit decline and consent, and skip without a default decision',
  {skip:!process.env.MOSAIC_BROWSER_TESTS},async t=>{
    const home=await mkdtemp(path.join(os.tmpdir(),'mongo-survey-ui-'));t.after(()=>rm(home,{recursive:true,force:true}));
    const store=new ApplicationStore(home),form=initial(),profileSha256=digest(profile);
    await store.write('jobs.json',[job]);await store.write('application-profile.json',profile);
    await observeGreenhouseQuestions({store,job,form,missing:fillPlan(form,profile).missing,profileSha256});
    const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,channel:process.env.MOSAIC_TEST_CHANNEL||undefined});
    t.after(()=>browser.close());const context=await browser.newContext(), page=await context.newPage();
    const requests=[];
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.hostname!=='mosaic.localhost'){requests.push(request.url());return route.abort();}
      if(url.pathname==='/api/inbox')return route.fulfill({json:await readGreenhouseInbox(store)});
      if(url.pathname==='/api/inbox/posting-permission'){
        requests.push(request.postDataJSON().decision);
        await decidePostingPermission({store,...request.postDataJSON()});return route.fulfill({json:{output:'Decision saved.'}});
      }
      return route.fulfill({contentType:'text/html',body:'<main><h1 id="inboxTitle">Needs your input</h1><p id="inboxNotice"></p><p id="inboxSummary"></p><div id="qualityPackets"></div><div id="inboxList"></div><div id="inboxReviews"></div><div id="savedGreenhouse"><div id="savedGreenhouseList"></div></div></main><script>const token="synthetic";</script>'});
    });
    await page.goto('http://mosaic.localhost');
    await page.addScriptTag({path:new URL('../web/inbox.js',import.meta.url).pathname});
    const group=page.getByRole('group',{name:job.company+' · '+job.title});
    const consentButton=group.getByRole('button',{name:'Decline every survey question and authorize the consent shown'});
    const custom=group.getByRole('link',{name:'Choose my own answers on the employer form'});
    await consentButton.waitFor();
    assert.match(await group.innerText(),/No choice is selected/);
    assert.ok((await group.innerText()).includes(survey.description));
    assert.equal(await group.getByText(decline,{exact:true}).count(),6);
    assert.ok(await group.getByRole('button',{name:'Skip this application'}).isVisible());
    assert.equal(await custom.getAttribute('href'),applicationPosting(job.url).url);
    assert.deepEqual(requests,[]);assert.deepEqual((await readGreenhouseInbox(store)).readyJobIds,[]);
    const reply=page.waitForResponse(r=>r.url().endsWith('/api/inbox/posting-permission'));
    await consentButton.click();assert.equal((await reply).status(),200);
    assert.deepEqual(requests,['allow']);
    const state=await readGreenhouseAnswers(store);
    assert.deepEqual(approvedPostingPermission(state,{job,form,profileSha256}).fields.map(f=>f.answer),[...Array(6).fill(decline),'true']);
  });
