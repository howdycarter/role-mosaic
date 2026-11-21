// Review actions are explicitly initiated here. Opening an inbox card only reads local records.
function renderInboxReview(row, api, refresh) {
  function el(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function field(parent, title, control) {
    const label = el('label',title); control.setAttribute('aria-label',title); label.append(control); parent.append(label); return control;
  }
  function action(parent, title, fn) {
    const b = el('button',title); b.type='button';
    b.onclick=async () => { b.disabled=true; message.textContent=''; try { await fn(); }
      catch (error) { message.textContent=error.message; } finally { b.disabled=false; } };
    parent.append(b);
  }
  function link(parent,title,url) {
    const a = el('a',title); a.href=url; a.target='_blank'; a.rel='noopener noreferrer'; parent.append(a);
  }
  const item = el('details'), message = el('p'); message.setAttribute('role','status');
  const kinds={evidence:'Review qualifications',form:'Complete employer form',posting:'Check posting',
    receipt:'Verify employer receipt',draft:'Review application draft'};
  item.append(el('summary',[row.company,row.title,kinds[row.kind]].filter(Boolean).join(' · ')),el('p',row.reason));
  if(row.questions?.length) {
    const qs=el('ul'); for(const q of row.questions)qs.append(el('li',q)); item.append(qs);
  }
  const actions = el('nav'); item.append(actions,message);
  if (row.kind==='evidence') {
    if (/^[0-9a-f]{64}$/.test(row.packetId||'')) link(actions,'Open evidence packet','/api/packet?id='+row.packetId);
    const editor=el('div'); item.append(editor);
    action(actions,row.focusedEvidence?'Answer questions':'Review this role',async () => {
      const review = await api('/api/inbox/role-review?jobId='+encodeURIComponent(row.jobId));
      editor.replaceChildren(row.focusedEvidence ? answerForm(review) : roleForm(review));
      editor.querySelector('textarea, input')?.focus();
    });
  }
  if (row.attemptId) {
    const originalPort=row.verificationDashboardPort;
    if(Number.isInteger(originalPort) && originalPort>=1024 && originalPort<=65535 && String(originalPort)!==location.port){
      link(actions,'Enter email code in original Mosaic window','http://127.0.0.1:'+originalPort+'/#attempt-'+encodeURIComponent(row.attemptId));
    } else action(actions, 'View original attempt', async () => {
      await load();
      const target=document.getElementById('attempt-'+row.attemptId);
      if(!target)throw Error('Refresh the inbox to see the latest application state.');
      target.focus(); target.scrollIntoView({block:'center'});
    });
    if(row.kind==='receipt') action(actions,'Check for a confirmation',async () => {
      await api('/api/application-reconcile',{});
      await refresh(); message.textContent='Receipt check finished. A verified confirmation clears this item.';
    });
    else action(actions,'Show preserved employer tab',async () => {
      await api('/api/application-review',{attemptId:row.attemptId});
      message.textContent='The preserved application tab is open.';
    });
  } else if(row.url) {
    try {const u=new URL(row.url); if(u.protocol==='https:' && !u.username && !u.password)link(actions,'Read employer posting',u.href);} catch {}
    if(row.kind==='form')item.append(el('p','Complete these fields directly on the employer form. If you submit there, record the outcome in Opportunities before running Mosaic again.'));
  }
  return item;

  function answerForm(review) {
    const form=el('form');
    if (!review.applicantQuestions.length) return el('p','These questions have already been answered or resolved.');
    const inputs=review.applicantQuestions.map(question=>{
      const input=field(form,question,el('textarea'));input.maxLength=5000;
      return {question,input};
    });
    const submit=el('button','Save answers');submit.type='submit';form.append(submit);
    form.onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;
      try{
        const answers=inputs.map(({question,input})=>({question,answer:input.value.trim()})).filter(row=>row.answer);
        if(!answers.length)throw Error('Enter at least one answer.');
        const result=await api('/api/inbox/evidence-replies',{jobId:review.jobId,revision:review.revision,answers});
        form.replaceWith(el('p',result.output));await refresh();
      }catch(error){message.textContent=error.message;}finally{submit.disabled=false;}
    };
    return form;
  }

  function roleForm(review) {
    const form=el('form'), job=el('details'), body=el('pre',review.description);
    job.append(el('summary','Current employer posting'),body); form.append(job);
    form.append(el('p','Résumé · '+review.track+' · '+review.resume.status+(review.resume.filename?' · '+review.resume.filename:'')));
    if(review.resume.status!=='approved')form.append(el('p','Register and approve the exact PDF for this track in your private workspace before submission.'));
    if(review.reasons.length)form.append(el('p',review.reasons.join(' · ')));
    const sources=el('details'); sources.append(el('summary','Verified career evidence ('+review.facts.length+')'));
    const quotes=el('ul'); for(const f of review.facts)quotes.append(el('li',f.id+' · '+f.text+' · Source '+f.sourceId));
    sources.append(quotes);form.append(sources);
    const rows=el('div'); form.append(el('p','Read the posting and list every mandatory requirement. Copy its wording and select the verified evidence that supports it.'),rows);
    function evidencePicker(parent,title,selected=[]) {
      const pick=el('select'); pick.multiple=true; pick.size=Math.max(2,Math.min(review.facts.length,4));
      for(const f of review.facts)pick.add(new Option(f.id+' · '+f.text,f.id,false,selected.includes(f.id)));
      return field(parent,title,pick);
    }
    function addRequirement(r={}) {
      const detail=el('fieldset'); detail.append(el('legend','Requirement'));
      const text=field(detail,'Exact wording from the posting',el('textarea')); text.value=r.text||'';text.required=true;text.maxLength=3000;
      const status=field(detail,'Assessment',el('select'));
      for(const [v,l] of [['unknown','Needs evidence'],['supported','Supported'],['contradicted','Contradicted']])status.add(new Option(l,v));
      status.value=r.status||'unknown';
      const proof=evidencePicker(detail,'Verified facts',r.evidenceIds||[]);
      detail.readRequirement=()=>({text:text.value,status:status.value,evidenceIds:[...proof.selectedOptions].map(o=>o.value)});
      action(detail,'Remove requirement',()=>detail.remove());
      rows.append(detail);
    }
    (review.requirements.length?review.requirements:[{}]).forEach(addRequirement);
    action(form,'Add requirement',()=>addRequirement());
    let ic,why,icFacts;
    if(review.needsIC) {
      if(review.canReviewIC) {
        ic=el('input');ic.type='checkbox';field(form,'I reviewed this individual-contributor specialization for this posting and current résumé. This decision lasts 24 hours.',ic);
        why=field(form,'How does your experience meet this specialization?',el('textarea'));why.maxLength=3000;
        icFacts=evidencePicker(form,'Evidence for the specialization');
        ic.onchange=()=>{why.required=ic.checked;icFacts.required=ic.checked;};
      } else form.append(el('p','Specialization approval requires a current standing authorization for this track’s approved résumé.'));
    }
    const reviewer=field(form,'Reviewer name',el('input'));reviewer.required=true;reviewer.maxLength=200;
    const confirm=el('input');confirm.type='checkbox';confirm.required=true;
    field(form,'I reviewed every mandatory requirement against this posting and the listed sources.',confirm);
    const submit=el('button','Save role review');submit.type='submit';form.append(submit);
    form.onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;
      try{
        const result=await api('/api/inbox/role-review',{jobId:review.jobId,revision:review.revision,
          requirements:[...rows.children].map(n=>n.readRequirement()),reviewer:reviewer.value,confirm:confirm.checked,
          approveIC:!!ic?.checked,icEvidence:why?.value,icFactIds:icFacts?[...icFacts.selectedOptions].map(o=>o.value):[]});
        form.replaceWith(el('p',result.output));await refresh();
      }catch(error){message.textContent=error.message;}finally{submit.disabled=false;}
    };
    return form;
  }
}
