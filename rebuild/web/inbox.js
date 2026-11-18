// All inbox actions use this dashboard's loopback session.
(() => {
  const byId = id => document.getElementById(id);
  const list = byId('inboxList');
  const notice = byId('inboxNotice');
  const labels = { posting: 'Only this application', employer: 'Matching questions at this employer', future: 'Matching questions at any employer' };
  const cards = new Map();
  const reviewCards = new Map();
  let generation = 0;
  let fetchVersion = 0;
  let lastPacket = null;

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function api(url, payload) {
    const options = payload === undefined ? {} : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rolemosaic-Token': token },
      body: JSON.stringify(payload),
    };
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Mosaic could not complete that request.');
    return data;
  }

  function labeled(form, title, control) {
    const label = element('label', title);
    label.append(control);
    form.append(label);
  }

  function questionCard(item) {
    const form = element('form'), fieldset = element('fieldset');
    fieldset.append(element('legend', item.label));
    if (item.help) fieldset.append(element('p', item.help));
    const application = element('select');
    item.postings.forEach((p, i) => {
      const option = new Option(p.company + ' · ' + p.title + (p.channel === 'manual' ? ' (manual packet)' : ''), p.jobId);
      option.dataset.index = i;
      application.add(option);
    });
    labeled(fieldset, 'Application', application);
    const scope = element('select');
    for (const key of item.scopes) scope.add(new Option(labels[key], key));
    labeled(fieldset, 'Use this answer for', scope);
    const recipients = element('p');
    fieldset.append(recipients);
    function selected() { return item.postings[Number(application.selectedOptions[0].dataset.index)]; }
    function showScope() {
      const p = selected();
      if (scope.value === 'posting') recipients.textContent = p.company + ' · ' + p.title;
      else {
        const board = new URL(p.url).pathname.split('/')[1];
        const affected = item.postings.filter(other => scope.value === 'future' || new URL(other.url).pathname.split('/')[1] === board);
        const count = new Set(affected.map(posting => posting.jobId)).size;
        const companies = [...new Set(affected.map(posting => posting.company))];
        recipients.textContent = count + (count === 1 ? ' current application' : ' current applications') + ' at ' + companies.join(', ') +
          (scope.value === 'future' ? '. Future employers can use this answer for this same question.' : '. Future matching questions on this employer’s board can use this answer.');
      }
    }
    application.onchange = showScope;
    scope.onchange = showScope;
    showScope();
    let input;
    if (item.type === 'select') {
      input = element('select');
      input.add(new Option('Choose an answer', ''));
      for (const value of item.options) input.add(new Option(value, value));
    } else {
      input = element(item.type === 'textarea' ? 'textarea' : 'input');
      if (item.type === 'textarea') input.rows = 3;
      else input.type = item.type;
      if (item.type === 'number') input.step = 'any';
      input.maxLength = 5000;
    }
    input.required = true;
    labeled(fieldset, 'Your answer', input);
    const button = element('button', 'Save answer and continue');
    button.type = 'submit';
    fieldset.append(button);
    form.append(fieldset);
    form.onsubmit = async event => {
      event.preventDefault();
      const p = selected();
      button.disabled = true;
      try {
        const result = await api('/api/inbox/answer', {
          id: item.id, jobId: p.jobId, channel: p.channel, revision: p.revision,
          scope: scope.value, answer: input.value, confirm: true,
        });
        notice.textContent = result.output;
        await refresh();
        if (lastPacket) await checkPacket(lastPacket, false);
        if (!form.isConnected) (list.querySelector('select') || byId('inboxTitle')).focus();
      } catch (error) { notice.textContent = error.message; }
      finally { button.disabled = false; }
    };
    return form;
  }

  let savedStamp;
  function renderSaved(answers = []) {
    const stamp = JSON.stringify(answers);
    if (stamp === savedStamp) return;
    savedStamp = stamp;
    const parent = byId('savedGreenhouse');
    parent.hidden = !answers.length;
    const rows = byId('savedGreenhouseList');
    rows.replaceChildren();
    for (const answer of answers) {
      const row = element('p');
      row.append(element('strong', answer.label), document.createTextNode(' · ' + labels[answer.scope] +
        (answer.scope === 'future' ? '' : ' · ' + [answer.company, answer.scope === 'posting' && answer.title].filter(Boolean).join(' · ')) + ' '));
      const forget = element('button', 'Forget answer');
      forget.type = 'button';
      forget.onclick = async () => {
        forget.disabled = true;
        try {
          const result = await api('/api/inbox/forget', { id: answer.id });
          notice.textContent = result.output;
          await refresh();
          if (lastPacket) await checkPacket(lastPacket, false);
        } catch (error) { notice.textContent = error.message; }
        finally { forget.disabled = false; }
      };
      row.append(forget);
      rows.append(row);
    }
  }

  async function refresh() {
    const version = ++fetchVersion;
    const inbox = await api('/api/inbox');
    if (version !== fetchVersion) return;
    const count = inbox.items.length;
    const current = new Set(inbox.items.map(item => item.id));
    for (const [id, card] of cards) {
      if (!current.has(id)) { card.node.remove(); cards.delete(id); }
    }
    for (const item of inbox.items) {
      const stamp = JSON.stringify(item);
      const old = cards.get(item.id);
      if (old?.stamp === stamp) continue;
      // Preserve input while a background refresh discovers other work.
      if (old?.node.contains(document.activeElement)) continue;
      const node = questionCard(item);
      if (old) old.node.replaceWith(node); else list.append(node);
      cards.set(item.id, { stamp, node });
    }
    const reviews=inbox.reviews || [];
    const currentReviews=new Set();
    for (const row of reviews) {
      const id=row.attemptId ? 'attempt:'+row.attemptId : 'job:'+row.jobId, stamp=JSON.stringify(row);
      currentReviews.add(id);
      const old=reviewCards.get(id);
      if(old?.stamp===stamp || old?.node.querySelector('form'))continue;
      const node=renderInboxReview(row,api,refresh);
      if(old){node.open=old.node.open;old.node.replaceWith(node);}else byId('inboxReviews').append(node);
      reviewCards.set(id,{node,stamp});
    }
    for(const [id,card] of reviewCards)if(!currentReviews.has(id)){card.node.remove();reviewCards.delete(id);}
    byId('inboxSummary').textContent = count || reviews.length
      ? count+(count===1?' question':' questions')+' to answer · '+reviews.length+(reviews.length===1?' application':' applications')+' to review.'
      : 'Nothing needs your input right now.';
    renderSaved(inbox.savedAnswers);
  }

  async function checkPacket(packetId, focus) {
    const request = ++generation;
    lastPacket = packetId;
    const summary = byId('checkedQuestions');
    summary.replaceChildren(element('p', 'Checking the employer’s published questions…'));
    try {
      const result = await api('/api/inbox/check-packet', { packetId });
      if (generation !== request) return;
      summary.replaceChildren(element('h3', result.company + ' · ' + result.title),
        element('p', result.checked + (result.checked === 1 ? ' required custom field checked.' : ' required custom fields checked.') + ' Complete any remaining questions on the employer form.'));
      for (const answer of result.saved) summary.append(element('p', answer.label + ' — ' + answer.answer));
      await refresh();
    } catch (error) {
      if (generation === request) summary.textContent = error.message;
    }
    if (focus) byId('inboxTitle').focus();
  }

  byId('qualityPackets').addEventListener('click', event => {
    const button = event.target.closest('button[data-check-packet]');
    if (button) void checkPacket(button.dataset.checkPacket, true);
  });
  const sync = () => refresh().catch(error => { notice.textContent = error.message; });
  window.addEventListener('focus', sync);
  window.addEventListener('mosaic-run-finished', sync);
  setInterval(() => { if (!document.hidden) sync(); }, 6000);
  sync();
})();
