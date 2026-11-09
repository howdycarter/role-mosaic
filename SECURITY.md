# Security policy

## Reporting

Use GitHub's private vulnerability reporting:
https://github.com/howdycarter/role-mosaic/security/advisories/new.
Do not open a public issue for anything that involves personal data, API
keys, or a way to make the tool submit something a user did not intend.
Expect a reply within a week.

## Scope

In scope: the CLI, the browser scripts in `src/forms/`, the skills in
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
