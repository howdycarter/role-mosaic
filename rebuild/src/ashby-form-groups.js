// Runs in the native browser page. Keep the label, help and choices from one field together.
export function inspectAshbyGroups() {
  const visible = element => element.getClientRects().length > 0;
  const groupContext = (element, label) => {
    const container = element.closest('.ashby-application-form-field-entry') || element;
    const omitted = 'label,legend,input,textarea,select,button,[role="radio"],[role="checkbox"],script,style,[hidden],[aria-hidden="true"]';
    const remaining = container.cloneNode(true);
    remaining.querySelectorAll(omitted).forEach(node => node.remove());
    const pieces = [remaining.textContent];
    const controls = [element, label, ...element.querySelectorAll('[aria-describedby]')];
    for (const control of controls) {
      for (const id of (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) {
        const help = document.getElementById(id);
        if (help && !container.contains(help)) pieces.push(help.innerText);
      }
    }
    const description = [...new Set(pieces.filter(Boolean).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].join(' ');
    const policyLinks = [...container.querySelectorAll('a[href]')].filter(visible).map(a => ({text:a.innerText.trim(),url:a.href}));
    return {...(description ? {description} : {}), ...(policyLinks.length ? {policyLinks} : {})};
  };
  const groups = [];
  for (const entry of document.querySelectorAll('.ashby-application-form-field-entry[data-field-path]')) {
    if (!visible(entry)) continue;
    const label = entry.querySelector('label'), id = entry.getAttribute('data-field-path');
    if (!label || !id) continue;
    const selector = '[data-field-path='+JSON.stringify(id)+']';
    const buttons = [...entry.querySelectorAll('button[aria-pressed]')].filter(visible);
    if (buttons.length) {
      groups.push({id, selector, label:label.innerText.trim(), type:'button-choice',
        required:/required/i.test(label.className)||label.getAttribute('aria-required')==='true',
        value:buttons.find(b=>b.getAttribute('aria-pressed')==='true')?.innerText.trim()||'',
        options:buttons.map(b=>b.innerText.trim()), ...groupContext(entry,label)});
    } else {
      const combo = entry.querySelector('button[role="combobox"],input[role="combobox"]');
      if (combo) groups.push({id, selector:selector+' '+combo.tagName.toLowerCase()+'[role="combobox"]',
        label:label.innerText.trim(), type:'select', required:/required/i.test(label.className)||combo.getAttribute('aria-required')==='true',
        value:combo.tagName==='INPUT'?combo.value:/^select/i.test(combo.innerText.trim())?'':combo.innerText.trim(), options:[]});
    }
  }
  for (const fieldset of document.querySelectorAll('fieldset.ashby-application-form-input-radio-group')) {
    const label = fieldset.querySelector('label.ashby-application-form-question-title');
    const radios = [...fieldset.querySelectorAll('input[type="radio"]')];
    if (!visible(fieldset) || !label?.htmlFor || !radios.length) continue;
    const option = radio => [...(radio.labels || [])].map(l=>l.innerText.trim()).join(' ');
    const selected = radios.find(r=>r.checked);
    groups.push({id:label.htmlFor, selector:'fieldset.ashby-application-form-input-radio-group:has(> label[for='+JSON.stringify(label.htmlFor)+'])',
      label:label.innerText.trim(), type:'radio-choice', required:/required/i.test(label.className),
      value:selected ? option(selected) : '', options:radios.map(option), controlIds:radios.map(r=>r.id), ...groupContext(fieldset,label)});
  }
  return groups;
}
