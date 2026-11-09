# RoleMosaic independent rebuild (early development)

A new, dependency-free Node.js core built alongside the legacy fork. It collects public company boards, scores title and location against local rules, checks an imported history snapshot, retains tracking states, and produces a local HTML report. It does not create or submit applications. Scores are simple rule matches, not predictions of suitability.

Requires Node.js 22 or newer. Run commands from this directory:

1. `npm start -- import-legacy ..` imports the existing local search and history once and records local paths to the profile and résumé. It does not read the résumé, connect to Notion, or synchronize profile changes.
2. Edit `private/connections.json` to add actual public company boards, for example `"boards": [{"type":"greenhouse","slug":"example","company":"Example"}]`. Supported types: `greenhouse`, `lever`, `ashby`; example is a placeholder.
3. Run `npm start -- discover`, then `npm start -- report` and open the printed local file. `npm start -- list` displays IDs; use `npm start -- mark ID saved` (or `dismissed`, `applied`, `interview`, `rejected`, `offer`) to track decisions.

Private files are stored in the ignored `private/` directory or `ROLEMOSAIC_HOME`. Imported history is a snapshot, not a live tracker. Discovery contacts configured public employer APIs. Compensation is not evaluated yet and postings may close after collection. Automatic applications and scheduling are not implemented.

Run `npm test` for focused tests. The legacy fork is separate and retains upstream attribution.
