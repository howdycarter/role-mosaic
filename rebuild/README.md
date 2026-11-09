# RoleMosaic independent rebuild (early development)

A new, dependency-free Node.js core built alongside the legacy fork. It collects public company boards, scores title and location against local rules, checks an imported history snapshot, retains tracking states, and produces a local HTML report. It does not create or submit applications. Scores are simple rule matches, not predictions of suitability.

Requires Node.js 22 or newer. Run commands from this directory:

1. `npm start -- import-legacy ..` imports the existing local search and history once and records local paths to the profile and résumé. It does not read the résumé, connect to Notion, or synchronize profile changes.
2. Edit `private/connections.json` to add actual public company boards, for example `"boards": [{"type":"greenhouse","slug":"example","company":"Example"}]`. Supported types: `greenhouse`, `lever`, `ashby`; example is a placeholder.
3. Run `npm start -- discover`, then `npm start -- report` and open the printed local file. `npm start -- list` displays IDs; use `npm start -- mark ID saved` (or `dismissed`, `applied`, `interview`, `rejected`, `offer`) to track decisions.

Private files are stored in the ignored `private/` directory or `ROLEMOSAIC_HOME`. Imported history is a snapshot, not a live tracker. Discovery contacts configured public employer APIs. Compensation is not evaluated yet and postings may close after collection. Automatic applications and scheduling are not implemented.

Run `npm test` for focused tests. The legacy fork is separate and retains upstream attribution.

## Local application

Run `npm run app`, then open http://127.0.0.1:4317. Search and filter jobs, update tracking states, refresh configured boards, and inspect the résumé retrieved through Codex's Notion connector. The local server binds to loopback; writes require the current session token and a same-origin request. Private résumé snapshots and applicant records remain ignored by Git.

Matching now retains query-string posting IDs, checks employer exclusions, and requires documented annual base compensation to clear the configured floor. Salary extraction is conservative and heuristic: always verify context on the employer page. The current scoring does not assess the full résumé's semantic fit. Historical records remain snapshots and are not sufficient proof against reapplication.

The Notion snapshot was fetched through the connected Codex tool. This is not an unattended Notion integration: refreshing requires Codex to fetch the page again. Automatic application remains blocked. The master résumé itself contains unresolved facts and has not been approved for external applications. No browser submission adapter or employer receipt verification has been implemented in this independent build. Do not use tracking status changes as evidence of submission.
