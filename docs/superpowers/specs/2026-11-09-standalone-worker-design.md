# Standalone Mosaic worker

The user selected a local Playwright worker so the application can operate without an active Codex chat. Preserve existing applicant configuration, approved PDF, history, exact posting approvals, daily attempt/budget limits and durable receipts. Do not reuse a personal Chrome profile or copy browser credentials from Codex.

## Approaches

- Continue using the Codex Browser adapter: already exercised, but requires an active chat.
- **Selected: local Playwright browser and worker owned by Mosaic.** Dedicated private persistent Chrome profile, loopback dashboard, serial work and local timer. Browser exceptions are visible in its own browser.
- Cloud browser service: adds credential, hosting, cost and privacy requirements; deferred.

## Components and boundaries

1. Native Playwright adapter implements the existing inspection/fill/verification/submission/receipt interface. No Codex runtime import. It supports conservatively recognized hosted forms; unknown widgets, consent, CAPTCHA, accounts and missing facts hold before submission. Do not solve CAPTCHA or invent facts.
2. Worker discovers configured boards, reconciles uncertain receipts read-only, prepares bounded candidates and executes only unexpired, specifically approved packets. Held drafts require an explicit resume action, never an automatic retry. Preserve pending packets and use a process lock. Browser sessions and receipt screenshots remain private.
3. Dashboard starts/pauses/runs the worker, displays health and per-job blockers, and approves the exact recipient/data. Starting a worker never authorizes a new application. Applicant-controlled approval enables independent execution. Do not imply that a timer or a tracking mark is a confirmed submission.
4. Notion: existing local career snapshot and approved PDF work without Codex. Optional direct Notion integration uses an applicant-supplied private credential and page ID. Background synchronization must be labeled unavailable until authenticated. Fresh career text is evidence and cannot replace approved PDF/facts automatically.

## Acceptance

Run real Playwright against isolated synthetic hosted-form routes to prove preparation sends no applicant data, authorized upload/submission yields exactly one receipt, blocked required widgets/changed pages hold, restart reconciliation never clicks Submit, and duplicate/daily/budget gates still apply. Then start the standalone dashboard/worker on this Mac, perform public discovery and prepare real candidates. A real employer receipt remains a separate acceptance gate, requiring actual posting approval and supported controls. A macOS login service is optional and must not be represented as installed merely because the server is running.
