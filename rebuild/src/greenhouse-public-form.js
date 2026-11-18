import {htmlText} from './career.js';

// The public Greenhouse API exposes custom questions without opening a draft.
const fieldTypes = {
  input_text: 'text',
  input_number: 'number',
  textarea: 'textarea',
  multi_value_single_select: 'select',
};
const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function publicGreenhouseForm(questions) {
  if (!Array.isArray(questions)) return null;
  const fields = [];
  for (const question of questions) {
    const label = text(question?.label);
    if (!label || !question.required || !Array.isArray(question.fields) || question.fields.length !== 1) continue;
    const input = question.fields[0];
    if (!/^question_\d+$/.test(input?.name) || !Object.hasOwn(fieldTypes, input.type)) continue;
    const type = fieldTypes[input.type];
    const options = type === 'select' && Array.isArray(input.values)
      ? input.values.map(option => text(option?.label)) : [];
    if (type === 'select' && (!options.length || options.some(option => !option) || new Set(options).size !== options.length)) continue;
    const description = text(typeof question.description === 'string' ? htmlText(question.description) : '');
    fields.push({ id: input.name, label, type, required: true, options, ...(description ? { description } : {}) });
  }
  return { fields };
}

// React combobox inputs often expose an empty list until expanded. Bind the
// employer-published choices only to a unique, matching live control.
export function enrichGreenhouseFields(fields, publicForm) {
  if (!publicForm) return;
  const labelKey = label => text(label).replace(/\s*\*$/, '').trim();
  for (const field of fields) {
    if (!field.id) continue;
    const matches = publicForm.fields.filter(input => input.type === field.type && input.id === field.id &&
      labelKey(input.label) === labelKey(field.label));
    if (matches.length === 1 && fields.filter(input => input.id === field.id).length === 1) {
      const published = matches[0];
      if (field.type === 'select' && !field.options?.length) field.options = [...published.options];
      if (published.description && text(field.description) !== published.description) {
        field.description = [field.description, published.description].filter(Boolean).join(' ');
      }
    }
  }
}
