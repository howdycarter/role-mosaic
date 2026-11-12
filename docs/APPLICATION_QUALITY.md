# Prepare evidence-led applications

Mosaic defaults to **manual final submission**. Search, import and local packet preparation do not open employer forms, upload files or create submission attempts. Browser automation can be detected; neither automation nor manual submission guarantees interviews. Employer rejection reasons are usually unavailable to an applicant.

## Connect your own evidence and résumés

Create a private workspace following [the setup guide](../rebuild/README.md), import your complete career history, and configure your own search rules. From `rebuild/`:

```bash
npm start -- quality-init
npm start -- register-resume --track product --file /path/to/product-resume.pdf
npm start -- register-resume --track design --file /path/to/design-resume.pdf
npm start -- register-resume --track engineering --file /path/to/engineering-resume.pdf
```

Attachment creates a **draft**. After reviewing the exact bytes, register that track again with `--confirm reviewed`. Approval is stored separately with the track, file path and SHA-256. Replacing a track preserves its previous registry entry and files. A missing/changed/unapproved track PDF never falls back to another résumé.

Edit your private `career-evidence.json`. This minimal schema is illustrative; substitute your own real source and exact quotation:

```json
{
  "version": 1,
  "sources": [{"id": "own-career-notes", "path": "career-notes.md", "sha256": "SHA256_OF_YOUR_SOURCE_FILE"}],
  "facts": [{
    "id": "own-verified-fact", "sourceId": "own-career-notes",
    "text": "EXACT_QUOTE_FROM_YOUR_SOURCE", "quote": "EXACT_QUOTE_FROM_YOUR_SOURCE",
    "verified": false, "tracks": ["product"], "capabilities": ["product-strategy"]
  }],
  "caseStudies": []
}
```

Compute the source hash locally, for example `shasum -a 256 /path/to/career-notes.md`. Change `verified` only after checking the fact and its personal attribution. The source must contain the exact quote and `text` must equal that quote. Changing a source invalidates its evidence. A source quotation is provenance, not independent proof of truth: the applicant/reviewer remains responsible for accuracy. Never mark an unverified metric as verified just because an old résumé contains it.

Case studies use `{id, title, url, tracks, evidenceIds}`. Use your real HTTPS project URL and refer to verified fact IDs from the same track. Do not disclose confidential work. A generic portfolio link does not establish a specialized engineering achievement.

## Review each role

Mosaic identifies a conservative checklist of specialized requirements, including search/ranking systems, database infrastructure, speech research, cloud marketplaces/usage billing, and explicit tenure. Generic AI experience does not satisfy these categories. Preferred/nice-to-have requirements are not treated as mandatory. The extraction is **not exhaustive**; read the entire posting.

Create a private review JSON with every mandatory requirement:

```json
{"requirements":[
  {"text":"ACTUAL_EMPLOYER_REQUIREMENT", "status":"unknown", "evidenceIds":[]}
]}
```

Use `supported` only with relevant verified evidence IDs; keep unsupported requirements `unknown` or `contradicted`. Then record the actual reviewer and explicit review:

```bash
npm start -- review-role --job JOB_ID --file /path/to/review.json --reviewer "Your actual reviewer" --confirm reviewed
npm start -- prepare-packets --job JOB_ID
# Or prepare a small local shortlist:
npm start -- prepare-packets --limit 15
npm run app
```

Use **Prepare evidence packets** in the dashboard. Each private packet contains the chosen résumé status, source-backed proof points, case-study links, unresolved requirements, search-rule checks and submission-risk notes. Imported source text is escaped and packet scripts/network are disabled. No PDF or source document is sent to an employer by this action.

A ready packet requires a complete current requirement review, evidence for detected mandatory specialties/tenure, a matching approved résumé, relevant case-study evidence and passing title/location/base-pay rules. Reviews pin the posting, evidence and PDF; they expire after seven days or a change. `ready` means locally reviewed, not employer acceptance or interview eligibility.

## Experimental automatic execution

Manual mode blocks direct engine execution and held-draft resumption as well as dashboard submission. Old standing grants alone cannot override it. Existing read-only receipts and specifically authorized original-form email verification remain available, with their existing safeguards.

Automatic mode requires the explicit risk acknowledgement in the dashboard, a separately configured enabled application policy, current application authorization, and the same evidence gates. The active approved application PDF must match the selected track PDF bytes; a mismatch holds rather than swapping files silently. There is no universal ATS support or complete automatic inference of qualifications. Never disable quality review to force an uncertain applicant packet through. The compatibility flag `requireQualityReview:false` is honored only for non-native legacy integrations and synthetic engine adapters. Native Playwright applications always enforce quality review, regardless of that flag. Saved packets are revalidated when listed or opened; changed sources, PDFs, reviews, rules, postings or application status require regeneration.

All builds/tests run locally. Keep `career-evidence.json`, sources, reviews, résumé registry, PDFs and generated packets private. No applicant data or API key belongs in the public repository.

Discovery shortlists prioritize evidence and relevant case studies before the title-rule score, then prefer leadership roles. They include at most two roles per employer per preparation batch; explicitly selected roles are preserved. A source-backed quote does not by itself prove every requirement. All incomplete or expired reviews remain holds.
