# Application quality implementation plan

> Execution: native implementation in this session using the already-authorized repair scope; tests precede production changes.

**Goal:** Prepare evidence-led, track-specific application packets and prevent unchecked automated submissions.
**Architecture:** Add independent quality and packet modules; integrate conservative gates into the existing worker/engine and local dashboard. Applicant data remains in each private workspace.
**Tech stack:** Node ESM, existing local app, Node test runner and existing Playwright regression tests.
**Spec:** `docs/superpowers/specs/2026-11-11-application-quality-design.md`.

## Constraints and review focus

Local builds only, no new API key or cloud service. Preserve uncertain attempts and receipts. No hidden automation, invented claims, implicit PDF approval, source-text instructions or shared applicant configuration. Tests must exercise stale sources/reviews, preferred versus mandatory requirements, incorrect résumé track, direct-engine bypass, and untrusted rendered content.

## Tasks

1. Add `quality.js` and `quality.test.js`: source-pinned facts, track classification, mandatory specialization/years checklists, complete posting-bound review and separate résumé selection. Observe failing tests, implement, run focused suite.
2. Add `packets.js` and packet tests: generate private JSON/HTML from evidence and track résumé without browser calls; expose CLI `prepare-packets`, `register-resume`, and `quality-init`. Test file tampering, escaping and approval state.
3. Add manual default and automatic quality gates in engine/worker/server. Synthetic native tests must seed source-backed test evidence and explicitly reviewed track PDFs; no native quality bypass is allowed. Test that manual preparation and direct submission paths never launch/fill/submit, and that automatic mode cannot bypass evidence or track-PDF checks.
4. Update dashboard and docs to show quality, selected résumé and packet links, distinguish manual preparation from experimental automatic execution, and disclose automation risk. Test the real local API and rendered workflow.
5. Configure applicant review-only state, source evidence and three résumé drafts privately; evaluate historical roles to demonstrate the changed behavior, prepare usable packets and log limitations in Notion. Preserve existing browser sessions. Run `npm run verify:local`, review staged data, push main, and build/verify the local runtime.
