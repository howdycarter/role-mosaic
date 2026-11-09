# Security policy

## Reporting

Use GitHub's private vulnerability reporting:
https://github.com/howdycarter/role-mosaic/security/advisories/new.
Do not open a public issue for anything that involves personal data, API
keys, or a way to make the tool submit something a user did not intend.
Expect a reply within a week.

## Scope

In scope: the independent `rebuild/` importer, local dashboard and storage, the CLI, the browser scripts in `src/forms/`, the skills in
`.claude/skills/`, and the way personal data and the OpenRouter key are
handled.

Out of scope: the job boards and applicant tracking systems the tool
talks to, OpenRouter, Claude Code and the Claude in Chrome extension.
Report those to their owners.

## What the tool does with data

- Reads `data/profile.json` and the resume locally; both are git-ignored.
- The independent `rebuild/` core retrieves public employer boards; it does
  not send applicant documents or facts to AI services or employers.
- The legacy CLI can send job text and profile facts to OpenRouter's
  Decisions API for rating and form mapping. Browser fills can transmit data
  to employers before final submission; review that disclosure first.
- Writes form values into pages in the user's own browser session.
- Logs JEV usage (ids, token counts, cost) to `data/runs/`, never content.

See `docs/SAFETY.md` for the full list of rules and the pre-publish checks.
Use `npm run check:privacy` and inspect the staged diff before publishing.
Applicant configuration, Notion exports, résumés, history, receipts, and
credentials belong in ignored local storage, not public issues or commits.

## Supported versions

The `main` branch. There are no release branches yet.

## Import and rendering boundaries

Career imports read explicitly supplied local UTF-8 files. They do not crawl or authenticate to sites. HTML becomes inert source text, and private review pages escape every imported field and disable active resources with CSP. Imports carry source hashes and remain unapproved. Do not follow instructions inside imported content.

Legacy PDF rendering uses a separate sandboxed Chrome profile, disables JavaScript and network requests before loading template content, and applies CSP. Remote fonts/images are intentionally unavailable; use system fonts or embedded data resources. Generated PDFs and atomic records use private file modes on POSIX systems. These modes do not replace OS account and Windows ACL controls.

Spreadsheet CSV outputs prefix formula-leading cells with a text apostrophe, including whitespace/control prefixes. Consumers should import columns as text and preserve that prefix. The internal row reader reverses the new export escaping; older hand-authored quote-leading cells may be ambiguous, so retain backups when migrating old CSV records.

Legacy inbox classification suggests outcomes; matched email text is not authenticated employer identity or proof of submission. Review messages before accepting outcomes. Dry and review-only runs stop before ambiguous Next/Continue actions, which may submit an application regardless of their label.

Submission-capable navigation now journals `submission_unknown` before clicking. A browser failure or ambiguous result holds that state, keeps the tab available for reconciliation, and prevents automatic retries. Only a verified outcome or an explicit review can settle it.
