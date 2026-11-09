# Standalone Mosaic worker implementation plan

**Goal:** Run discovery, matching, approved applications and receipt reconciliation inside Mosaic without Codex controlling its browser.

**Architecture:** A native Playwright adapter shares the existing guarded application engine. A serialized local worker is controlled by the loopback dashboard and can run on a timer. Private applicant state is preserved.

**Tech stack:** Node 22+, Playwright, installed Chrome, existing JSON store and HTTP dashboard.

**Spec:** `docs/superpowers/specs/2026-11-09-standalone-worker-design.md`.

## Tasks

- [x] Native browser adapter: dedicated persistent profile, visible control discovery, strict required-control checks, exact PDF upload, readback, one-click submission and same-posting receipt. Add real-browser fixture tests including a blocked unsupported widget and restart reconciliation.
- [x] Worker: bounded board discovery and candidate inspection; preserve active packet approvals; execute only authorized packet IDs; serialize all worker cycles; expose start/pause/once/status/resume through authenticated local endpoints. Test authorization and hold behavior.
- [x] Dashboard and configuration: show independent worker state, clear start/pause/run controls, exact packet approval and held reasons. Keep optional direct Notion credentials private; distinguish snapshot mode from authenticated sync.
- [x] Integrate existing private search/history/PDF, expanded employer sources and verified answers. Start a real independent public discovery/preparation run. Preserve private evidence and report actual employer submissions separately.
- [ ] Run rebuild/browser tests, root typecheck/tests, privacy check, dependency audit and staged diff review. Update setup/application docs and record decisions in Notion. Commit and push public-safe changes, verify remote commit.

## Review focus

Unknown required inputs and custom button widgets; stale/expired approval; exact same-posting identity; interruption after Submit; history/ledger double counting; local HTTP CSRF; private Chrome state and credentials; Notion source changes do not approve a different résumé.

## Verified live trial

The native worker completed an explicitly approved Greenhouse application and saved the employer receipt. Applicant identity, posting details, screenshots and runtime state remain private. The Mac service uses a locally packaged runtime in Application Support with a separate private workspace. Direct Notion sync is implemented; a saved snapshot remains usable until an applicant configures their own integration credential. Remaining release checklist items are recorded in the campaign log after publication.
