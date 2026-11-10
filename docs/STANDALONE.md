# Run Mosaic locally without Codex

Mosaic's Node server owns the scheduler and a native Playwright browser. No chat, browser extension, cloud build, Vercel deployment or AI API is required to run it. It does not take over your everyday Chrome profile.

## Set up

1. Follow `rebuild/README.md` to create your private applicant workspace, import your career history and choose search rules/boards. Reconcile previous applications. Review and approve your exact PDF and configure verified application facts using `docs/APPLICATIONS.md`.
2. Run `npm ci` in `rebuild/`. Install Google Chrome locally. The default worker uses `channel: "chrome"`; alternatively install Playwright Chromium with `npx playwright install chromium` and choose `channel: "chromium"` in private `worker.json`.
3. Run `npm run app` in `rebuild/`, then open http://127.0.0.1:4317. To use another workspace/port, set `ROLEMOSAIC_HOME` and `PORT` for the server process. Keep the workspace outside a public checkout or under ignored `private/`.
4. Choose **Search and prepare now**. The worker reads configured boards, checks history/rules, opens a bounded set of candidate forms and lists exact recipient/data packets. It enters no applicant data during preparation.
5. Enable **Automatic applications** after reviewing your current search rules, verified facts, approved PDF, daily limit and budget. Mosaic fills eligible applications, uploads the exact PDF, checks readback and submits through its own browser. Each attempt records the bound standing grant. In review mode, approve each specific packet and use **Submit approved applications** instead; packet approval expires after one hour.
6. Choose **Start scheduled worker** for a repeating local run (30 minutes by default). It searches and prepares new candidates and submits unexpired approved packets. Keep the server and Mac awake. With standing search-rule authorization enabled, eligible new packets run without per-job approval; review mode continues to require it. Pause stops the next application and is checked again before the current final submission.

## Exceptions and recovery

Mosaic uses a dedicated private Chrome profile. Complete account access and human verification there when required. Unsupported widgets and missing required facts remain holds; do not invent answers or force a Submit. A pre-submit held draft can be explicitly continued with **Continue this reviewed draft**. Under current native standing authorization, the engine re-inspects the live form and creates an audited replacement packet when recovering a draft after restart or expiration; it retains the original attempt. Review mode requires a valid original packet. A submitted or uncertain attempt is never retried. Receipt reconciliation only reads existing pages; when a preserved page is unavailable, the outcome stays uncertain.

On restart, the worker recovers open pages by exact employer/posting identity when Chrome restores them. Session restoration is not guaranteed. It does not copy cookies from Codex or attach to your everyday browser. Never remove ledger records to restart an attempt. Preserve verification tabs while the user completes them; restarting Chrome can lose an unresolved challenge.

The engine conservatively supports hosted Greenhouse, Ashby and Lever forms only where title, location, applicable annual USD base salary, required answers and controls are unambiguous. Custom ATSs, Workday, unrecognized widgets, unknown consents and CAPTCHA still need intervention. Supported Ashby radio/button/autocomplete widgets use observed choices and verified facts; known explicitly authorized consents are scoped to their posting. Published compensation without enough base/currency/period evidence is held. A completed source scan or a passing test is not proof that a real employer accepted an application.

## Notion without Codex

The approved PDF and saved career snapshot work locally. For ongoing Notion sync, create your own read-access integration, grant it access to your master career page, and enter the page ID and token under **Career history → Connect Notion directly to Mosaic**. Credentials are kept in `notion-credentials.json` in the private workspace (0600 on POSIX, not encrypted by Mosaic). You can supply `NOTION_API_KEY` in the server environment instead. The worker fetches source notes from Notion directly. It never promotes source claims into verified application facts or replaces your approved PDF automatically. Failed/oversized imports preserve the last snapshot.

## Keep it running on a Mac

Optional local login service, from the repository root:

```bash
node scripts/install-local-service.mjs --install
```

Set the same `ROLEMOSAIC_HOME` and `PORT` before installing if customized. Prefer a workspace under `~/Library/Application Support/RoleMosaic/` for a Mac login service; macOS may restrict background access to Documents. The installer builds a local runtime copy in Application Support and installs `com.rolemosaic.local` in your user's LaunchAgents folder. No private applicant state is included in that runtime copy. It runs after GUI login and restarts the local server; it does not prevent sleep. Private logs are in `service.log` in the workspace. Stop it with `launchctl bootout gui/$(id -u)/com.rolemosaic.local`. To restart an installed service, use `launchctl kickstart -k gui/$(id -u)/com.rolemosaic.local`. To update its runtime, run local verification, then invoke the installer with **both `--install --update`** and the same workspace/port environment. Updates refuse an active application/worker lock and preserve the old service file. Avoid restarting during a submission; preserve and reconcile uncertain outcomes.

## Local verification and publication

From the root, run `npm run verify:local`. This runs typecheck, legacy/rebuild tests, real Chrome/Chromium tests against isolated synthetic employer forms, privacy checks and both dependency audits locally. Install rebuild dependencies first. Tests never submit to an actual employer. There are no automatic GitHub Actions workflows and no Vercel deployment. Review staged files before pushing; never commit a browser profile, token, applicant export, résumé or receipt.

## Standing authorization for the native worker

Mosaic’s own Playwright worker can use an applicant’s explicit standing authorization instead of per-job approval. Enable **Automatic applications** in the dashboard after checking the displayed search rules and approved résumé. The grant is bound to exact résumé/profile/search hashes, daily submission limit, budget and timezone, and is recorded on each attempt. Changes or revocation stop it; enabling the timer alone does not create a grant. The Codex Browser adapter still follows its own action-time confirmation rules. Pre-submit holds do not consume a standing-mode final-submission slot; confirmed and uncertain submissions do. Provider costs remain reserved for all attempts. Missing answers, unsupported controls, ambiguous eligibility and human verification still hold the affected role while other eligible roles continue. Employer-published structured annual salary evidence is used when available; bonus, equity, OTE and foreign-currency figures cannot satisfy the USD base-salary floor.

For a separate native browser session during local development, `ROLEMOSAIC_BROWSER_SLOT=campaign` creates a private sibling profile inside the same workspace. Slot names contain only lowercase letters, digits and hyphens. All slots share the same cross-process worker lock and submission ledger; never run two schedulers for one applicant. Slots do not import another browser's cookies or permissions.
