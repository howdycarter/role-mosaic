# Linux migration and monitoring

The independent core runs on Node 22 or later. Keep it on loopback and reach it through an authenticated SSH tunnel; the local dashboard is not a public multi-user service. Builds, dependency installation and tests run on the authorized host, never in hosted CI.

Before migration, inventory the exact source commit, active runtime, worker settings, policy, scheduled jobs, Notion mode, résumé variants, application history and submission ledger. Stop scheduled research and keep application submission disabled during transfer. Preserve the original installation until the destination, access path, backup and restore have been verified.

Use an encrypted private transfer such as SSH/SCP. Export an explicit manifest of durable files with sizes and SHA-256 hashes. Keep private exports, archives, profiles, PDFs, receipts, credentials and manifests outside Git. Do not copy a live Chrome profile or treat its cookies, tabs or verification challenge as portable. Keep the original browser available for unresolved submissions; migration never authorizes a retry. Transient locks, logs and helper scripts are not an active Linux workspace.

Keep a verified original snapshot on the destination before constructing the active workspace. Rewrite only machine-specific configuration paths, including `connections.json`, the policy's `resumeApprovalPath` and the referenced approval file's PDF path. Preserve PDF bytes and track approval status. Preserve the ledger/history bytes and ambiguous receipt state. Regenerate local packets because their stored paths and current assessment can differ; do not manufacture a requirements review or approve a new draft PDF.

For an initial research/manual deployment:

- Set `application-policy.json`: `enabled:false`, `submissionMode:"manual"`, `requireQualityReview:true`, `automationRiskAcknowledged:false`; disable any standing grant.
- Set `worker.json`: `enabled:false`, `autoSubmitApproved:false`. Scheduling and later browser installation are separate decisions.
- Keep direct Notion synchronization disabled if no separately authorized integration credential is configured. A saved Notion snapshot is not a live integration.
- Use a private workspace (directories 0700, files 0600). Run an unprivileged systemd service with an explicit `ROLEMOSAIC_HOME`, loopback `PORT`, restricted write paths, private temporary storage and restart-on-failure. Add a start guard rejecting an unexpectedly enabled application policy or worker.
- Install dependencies with the lockfile on Linux if browser execution will later be used. A research-only dashboard does not import Playwright until a browser operation is requested; do not mistake a working dashboard for verified native browser/application support.

## Health and failure checks

`GET /api/health` reports only liveness, mode, policy/worker enablement and record validity, without profiles, job titles, URLs, application answers, tokens or file paths. It remains protected by the local Host check. Malformed ledger/history/configuration returns a generic 503. Health is distinct from submission confirmation, packet readiness or discovery freshness.

A host monitor should check service state, this endpoint, expected manual/disabled policy, durable record parseability, private permissions, disk space, source hashes, backup age and the last discovery result. Report source failures and stale research separately from application outcomes. Do not call Submit, resume a draft, launch an employer browser or send résumé content as a monitoring action. Health alerts must contain check names/status only, never applicant details.

Configure recurring private backups for the namespace and service/monitoring units. Confirm that the estate backup actually includes the chosen directory; merely writing under `/opt` does not establish coverage. Check exclusions such as `.env`: document whether each required setting is in a backed-up unit, an approved secret store, or needs reconfiguration. Verify an archive's hashes, restore it into a separate private directory and exercise the restored dashboard on another loopback port with submission disabled. Keep an independent recovery copy and document its host/path. Backup-file existence alone is not recovery proof.

After destination and recovery verification, disable the old scheduler/service without deleting its source or private data, and preserve any separate original verification browser. Avoid two active writers. Record the installed commit, destination paths, service/timer names, tunnel command, monitoring/alert route, backup coverage, excluded state and remaining human review gates in a private handoff.
