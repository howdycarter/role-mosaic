// This child replaces all outbound reads before starting the real dashboard server.
import { once } from 'node:events';
import { PlaywrightApplicationAdapter } from '../../src/playwright-adapter.js';

const board = 'https://boards-api.greenhouse.io/v1/boards/example-studio/jobs';
const posting = {
  id: 301,
  title: 'Director of Product',
  absolute_url: 'https://job-boards.greenhouse.io/example-studio/jobs/301',
  content: 'Annual base salary $200,000 - $250,000 USD per year.',
  location: { name: 'Remote - United States' },
};
const question = {
  label: 'What is your notice period?',
  required: true,
  fields: [{ name: 'question_301', type: 'input_text' }],
};
if (process.argv[2] === 'serve') {
  const release = once(process, 'message');
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    process.send({ kind: 'request', url: String(url), method, hasBody: options.body != null,
      hasHeaders: options.headers != null });
    if (method !== 'GET' || options.body || options.headers) throw Error('Unexpected outbound request');
    if (url === board + '?content=true') {
      // Wait for the browser test to observe the busy button before discovery finishes.
      await release;
      return Response.json({ jobs: [posting], meta: { total: 1 } });
    }
    if (url === board + '/301?pay_transparency=true&questions=true') {
      return Response.json({ ...posting, questions: [question] });
    }
    throw Error('Unexpected fixture URL');
  };
  PlaywrightApplicationAdapter.launch = async () => {
    process.send({ kind: 'employer-browser' });
    throw Error('Manual run must not open an employer browser');
  };
  await import('../../src/server.js');
}
