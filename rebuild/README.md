# RoleMosaic independent rebuild (early development)

A new, dependency-free Node.js core built alongside the legacy fork. It collects public company boards, scores title and location against local rules, checks an imported history snapshot, retains tracking states, and produces a local HTML report. It does not create or submit applications. Scores are simple rule matches, not predictions of suitability.

Requires Node.js 22 or newer. No install, API key, AI subscription, or legacy applicant workspace is needed for this core. Run commands from this directory.

## Start with your own information

```bash
npm start -- init --resume /absolute/path/to/your-resume.pdf --search examples/search.json --boards examples/boards.json
```

This validates and copies your PDF into `private/resume.pdf`, creates your own `private/search.json`, an empty application history, and board connections. It never copies the fictional legacy example profile. Existing applicant files are not overwritten. The example boards are public employer boards; replace them with employers you want to search. Edit your private search rules and enter your own annual USD base salary floor; a null floor intentionally prevents listings from clearing the matching checks.

Optionally supply `--profile /path/to/verified-profile.json` to copy your own facts. This does not extract facts from the PDF, verify them, or approve the document for applications.

```bash
npm start -- discover
npm run app
```

Open http://127.0.0.1:4317 for the local dashboard. Discovery reads public employer APIs and does not upload your résumé or profile. It does not send applications. A match means configured rule checks passed, not verified professional suitability.

For a separate applicant workspace, set `ROLEMOSAIC_HOME` to a dedicated directory outside the checkout before every command. Never share one workspace between applicants. The default `private/` directory is git-ignored. If choosing another location inside a checkout, add it to that checkout's ignore rules yourself.

## Connect your own Notion career history

Export the relevant Notion page as Markdown, or ask a connected Codex Notion tool to retrieve that page and save its text to a local Markdown file. Then run:

```bash
npm start -- connect-notion --file /path/to/career-history.md --url https://www.notion.so/your-page
```

The dashboard displays the text and a link back to your page. This imports a private snapshot; it does not authenticate to Notion, keep the page synchronized, or approve its claims. Repeat after changes. Notion tokens do not belong in the repository.

## Import an existing legacy workspace

For users who already configured the older CLI:

1. `npm start -- import-legacy ..` imports the existing local search and history once and records local paths to the profile and résumé. It does not read the résumé, connect to Notion, or synchronize profile changes.
2. Edit `private/connections.json` to add actual public company boards, for example `"boards": [{"type":"greenhouse","slug":"example","company":"Example"}]`. Supported types: `greenhouse`, `lever`, `ashby`; example is a placeholder.
3. Run `npm start -- discover`, then `npm start -- report` and open the printed local file. `npm start -- list` displays IDs; use `npm start -- mark ID saved` (or `dismissed`, `applied`, `interview`, `rejected`, `offer`) to track decisions.

Private files are stored in the ignored `private/` directory or `ROLEMOSAIC_HOME`. Imported history is a snapshot, not a live tracker. Discovery contacts configured public employer APIs. Compensation extraction is heuristic and postings may close after collection. Automatic applications and scheduling are not implemented.

Run `npm test` for focused tests. The legacy fork is separate and retains upstream attribution.

## Local application

Run `npm run app`, then open http://127.0.0.1:4317. Search and filter jobs, update tracking states, refresh configured boards, and inspect the résumé retrieved through Codex's Notion connector. The local server binds to loopback; writes require the current session token and a same-origin request. Private résumé snapshots and applicant records remain ignored by Git.

Matching now retains query-string posting IDs, checks employer exclusions, and requires documented annual base compensation to clear the configured floor. Salary extraction is conservative and heuristic: always verify context on the employer page. The current scoring does not assess the full résumé's semantic fit. Historical records remain snapshots and are not sufficient proof against reapplication.

Notion snapshots are applicant supplied, either exported or retrieved through a connected tool. Automatic application remains blocked. Each applicant must reconcile their own facts and approve their own external résumé. No browser submission adapter or employer receipt verification has been implemented in this independent build. Do not use tracking status changes as evidence of submission.

## Before publishing your clone

Run `npm run check:privacy` from the repository root and inspect `git diff --cached`. The guard checks tracked runtime files, document attachments, credential patterns, home-folder paths, and matches against selected identity fields in your local legacy profile when present. It reports filenames and reasons without printing matched values. It is not a guarantee that arbitrary free text is free of personal information; review new examples and documentation before publishing. CI checks the committed tree too.
