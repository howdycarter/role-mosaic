# Browser-driven applications

**Default behavior changed:** use [evidence-led preparation](APPLICATION_QUALITY.md) for manual final submission. The browser-engine APIs below are an experimental automatic path; they require `submissionMode: "automatic"`, explicit native automation-risk acknowledgement and the current source/track-PDF quality gate. Missing mode defaults to manual and blocks filling/submission, including direct engine calls. Configuring application facts alone does not opt into automatic mode.

Mosaic can prepare, fill, submit and verify **supported one-page applications using its own local Playwright worker**. Codex Browser remains an optional adapter; the standalone worker does not require it. This is a serial, guarded workflow, not a universal ATS adapter. Greenhouse, Ashby and Lever hosted posting URLs are eligible for inspection; each actual form must expose supported controls. Custom sites, Workday, sign-in, account creation, CAPTCHA, unsupported widgets and unknown required answers are held for review. See [standalone setup](STANDALONE.md) for dashboard controls, scheduling and direct Notion sync.

Discovery/import work without API keys. The standalone worker uses the rebuild's Playwright dependency and installed Chrome or Chromium. Both browser adapters make no JEV/OpenRouter calls and estimate $0 provider cost. Other adapters must declare a cost estimate; the engine reserves that estimate against the configured daily budget. It cannot account for unrelated tools or account spending outside Mosaic.

## Configure your own applicant

1. Follow [setup](../rebuild/README.md). Supply your own résumé, verified career facts, search rules, boards and reconciled history. A master career document may contain unresolved claims; it is not an approved application résumé.
2. Review the exact external PDF, then bind approval to its bytes:

   ```bash
   npm start -- approve-resume --confirm reviewed
   ```

3. Copy the blank `examples/application-profile.json` to your private workspace. Fill only facts you can support. Leave unknown answers absent or null. `facts` is a small application-contact schema, separate from the legacy profile and full career history. Review it and set `verified` to `true` only after checking it yourself. Custom answers use `{ "question": "Exact visible question", "answer": "Your verified answer", "verified": true }` in `answers`; do not invent work authorization, tenure, demographic or legal answers.
4. Enable the workflow explicitly:

   ```bash
   npm start -- configure-applications --profile /absolute/path/to/verified-application-profile.json --max-per-day 15 --daily-budget 1 --timezone America/Chicago --confirm reviewed
   ```

   Existing application configuration is preserved rather than silently overwritten. The limit may be reduced to 1–15 daily attempts. Choose your own IANA timezone and budget. Initializing a workspace does not enable applications.

5. Import your career snapshot or connect Notion directly through the dashboard with your own read-access integration credential. Refresh the source before a run. Notion text remains evidence; it does not approve new facts or a different PDF. A changed PDF, verified profile or search configuration invalidates prepared packets.

## Prepare, authorize, run

For automatic native applications, enable **Automatic applications** after reviewing your configured search, approved PDF, verified facts and limits, then choose **Search and prepare now** or **Start scheduled worker**. In review mode, review each recipient/data packet, then choose **Approve this application** and **Submit approved applications**. **Start scheduled worker** repeats discovery and runs approved packets without an active Codex chat. Native standing mode authorizes eligible applications through the pinned search/profile/PDF grant, without fabricating packet approvals. Alternatively, the optional Codex Browser engine API remains:

```js
// In the trusted Codex Node REPL with an already selected Browser handle.
const { prepareApplications, runApplications, reconcileApplications, approvePackets } =
  await import('/absolute/path/to/role-mosaic/rebuild/src/applications.js');
const { CodexBrowserAdapter } =
  await import('/absolute/path/to/role-mosaic/rebuild/src/browser-adapter.js');
const home = '/absolute/path/to/your/private-workspace';
const adapter = new CodexBrowserAdapter(browser, { home });
const plan = await prepareApplications({ home, adapter, limit: 15 });
```

Preparation reads employer pages and forms but does **not** enter applicant details or upload files. It checks current title, country/location, applicable annual USD base salary, exclusions, known history, required answers, supported controls, verified applicant facts and exact PDF approval. IC specializations require review by default. Missing or ambiguous evidence produces a hold. It never lowers your salary floor to create more applications.

Open the dashboard with `npm run app`. Application review lists each recipient, role, applicable pay, exact résumé filename, field values to transmit and expiration. Approval authorizes one immutable packet, not every future job. Packets expire after one hour. Follow the connected Browser's action-time confirmation rules before filling personal details or submitting; standing automation permission does not replace a required recipient-specific confirmation.

After the applicant explicitly approves the specific recipient and data, `approvePackets({ home, ids: [...] })` records that authorization; the local dashboard's **Approve this application** button calls the same function. An assistant must not call it merely because a packet exists. Then:

```js
const results = await runApplications({ home, adapter, limit: 15 });
```

The runner checks approval, rules, current page, profile/PDF hashes, duplicate history, per-day reservations and cost before transmitting. It fills only supported verified answers, attaches the approved PDF and checks readback. Unknown consents and signatures require applicant input; explicitly verified, posting-scoped consent and attestation answers are supported by the native worker. Browser-redacted values are not considered verified; inspect the actual UI, then supply an evidence-backed `verifiedReadbacks` entry scoped to that job/control. Never fabricate this evidence or decode hidden data to bypass a redaction.

Every submission-capable click is preceded by a durable `submission_unknown` record. Submit is clicked once. The Browser driver briefly polls read-only state for a same-origin, same-posting confirmation with the application inputs and final button gone. A submission record requires that employer confirmation; a screenshot, receipt, résumé hash and history entry are retained privately. A tracking status alone is not a receipt.

## Holds and recovery

- **Missing facts or unsupported form:** ask the applicant or finish manually. No required answer is guessed.
- **CAPTCHA, account creation, legal terms or verification:** follow Browser confirmation/handoff rules. Do not solve, create accounts or accept new contact consent silently.
- **Held before Submit:** inspect the saved tab. Within the original packet's validity, explicitly continue the same attempt with `runApplications({ home, adapter, resumeAttemptId: 'ATTEMPT_ID' })`; it reuses the reservation. This is not an automatic retry. Under current native standing authorization, a pre-submit held attempt may instead be freshly inspected and assigned an audited replacement packet after a restart or expiration; it retains its original attempt identity. This never applies to uncertain or submitted attempts. Do not delete history/ledger to force another attempt.
- **Unknown after Submit:** never fill or click again. Use `reconcileApplications({ home, adapter })`, which only reads confirmation state and repairs bookkeeping. It can also repair history after a saved receipt survives a local write failure.
- **Abandoned run lock:** inspect the owner/run and browser state before recovery. Do not remove an active lock or erase an unknown submission to resume automatically.

`npm start -- applications` shows counts; the dashboard shows attempt status and holds. `application-ledger.json`, `application-plan.json`, `application-approvals.json`, `application-profile.json`, `application-policy.json` and `receipts/` live under the private workspace and must never be committed. In review mode, attempt reservations include held/unknown operations. Native standing mode reserves final-submission slots for confirmed/unknown attempts and imported same-day confirmed applications; a confirmed receipt represented in both ledger and history is counted once.

Only one run/import should modify a workspace at a time. The worker and application runner use cross-process exclusive locks; unrelated tools that directly edit JSON are not coordinated writers. Keep separate workspaces for different people. The local timer runs while the server is up; an optional macOS login service is described in the standalone guide. Builds and tests run locally, without GitHub Actions or Vercel.

## Standing authorization for the native worker

Mosaic’s own Playwright worker can use an applicant’s explicit standing authorization instead of per-job approval. Enable **Automatic applications** in the dashboard after checking the displayed search rules and approved résumé. The grant is bound to exact résumé/profile/search hashes, daily submission limit, budget and timezone, and is recorded on each attempt. Changes or revocation stop it; enabling the timer alone does not create a grant. The Codex Browser adapter still follows its own action-time confirmation rules. Pre-submit holds do not consume a standing-mode final-submission slot; confirmed and uncertain submissions do. Provider costs remain reserved for all attempts. Missing answers, unsupported controls, ambiguous eligibility and human verification still hold the affected role while other eligible roles continue. Employer-published structured annual salary evidence is used when available; bonus, equity, OTE and foreign-currency figures cannot satisfy the USD base-salary floor.
