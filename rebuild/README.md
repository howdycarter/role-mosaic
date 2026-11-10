# RoleMosaic — start your own search

A local job-search workspace with public employer-board discovery, configurable rule matching, application-history checks, a dashboard and its own Playwright worker. Requires **Node.js 22+**. Discovery/import need no API key or AI subscription. Run commands below from `rebuild/`; install Playwright with `npm ci` for the standalone worker.

Mosaic can search on a timer and fill, submit and verify supported one-page forms after specific packet authorization, without Codex controlling its browser. Optional direct Notion sync uses your own integration credential. Universal ATS support and semantic résumé matching are not implemented. Tracking a job as “applied” does not submit it. See [standalone setup](../docs/STANDALONE.md).

## 1. Create your private workspace

Clone the project, then choose one setup path:

```bash
git clone https://github.com/howdycarter/role-mosaic.git
cd role-mosaic/rebuild
npm ci
```

**Already have a résumé?** Attach your own PDF (20 MiB maximum):

```bash
npm start -- init --resume /absolute/path/to/your-resume.pdf --boards examples/boards.json
```

**Have career history but no résumé?** Import a local export or saved page:

```bash
npm start -- init --career /absolute/path/to/Positions.csv --boards examples/boards.json
```

**Starting from scratch?** Create a blank workspace and worksheet:

```bash
npm start -- init --boards examples/boards.json
```

Setup creates `private/search.json`, `connections.json`, an empty application history, `career-history.json`, `career-notes.md`, and `career-review.html`. Existing workspaces are refused, and no fictional profile is copied. `--profile /path/to/verified-profile.json` optionally copies your own JSON object; this does not validate its facts or make it compatible with the legacy CLI. PDF attachment is not document approval.

For another applicant, set `ROLEMOSAIC_HOME` to a separate **absolute directory outside this checkout**, for every command:

```bash
export ROLEMOSAIC_HOME="$HOME/.local/share/rolemosaic/my-search"
```

The default `private/` is ignored by Git. A custom folder inside a checkout needs its own ignore rule. Never share one workspace between applicants. Run only one import/setup command per workspace at a time; concurrent CLI imports are not serialized. Directory/file modes are 0700/0600 on POSIX systems; check Windows ACLs separately. Keep backups private.

## 2. Import career sources and review the evidence

Supported inputs are UTF-8 Markdown, text, saved HTML, positions CSV and structured JSON. Each input is limited to 2 MiB; each collection to 20 sources and 8 MiB. No import command contacts a website, login service, AI provider or employer.

| Source you already own | How to import it |
| --- | --- |
| Notion | Export your career page as Markdown and use `--career` or `import-career`. Keep original headings and dates. |
| LinkedIn | Download your own account-data export, extract the ZIP yourself, then import its positions CSV. Supported headers include `Company Name`, `Title`, `Started On`, `Finished On`, `Description`, `Location`. Export names and availability can vary. |
| Your portfolio or biography | Save the page as HTML in your browser, then import that file. The importer strips markup, scripts, navigation, forms and external resources to collect readable text. |
| Notes or old job descriptions | Save `.md` or `.txt` and import each source separately. Import only material you have the right to use. |
| Structured work history | Import a JSON array of roles, or an object with a `roles` array. See the schema below. |

```bash
npm start -- import-career --file /path/to/career-history.md --label "Career notes"
npm start -- import-career --file /path/to/my-portfolio.html --label "My portfolio"
npm start -- career-review
```

Open the printed `career-review.html` locally. It shows collected text, source labels, import times and SHA-256 hashes. CSV/JSON also produce structured roles; text/HTML remain evidence text, without guessed companies or dates. Duplicate file content is skipped. Distinct sources stay separate, including conflicting or overlapping employment. Imports reset review status; nothing is automatically verified.

Edit **`career-notes.md`** with missing details and corrections; it is preserved across imports. Run `career-review` again to refresh the review page. Do not edit the generated HTML or source JSON as your working notes.

JSON role shape (only `company` and `title` are required; omit unknown fields):

```json
{
  "roles": [
    {
      "company": "Example Company",
      "title": "Your actual title",
      "startDate": "2020",
      "endDate": "",
      "location": "",
      "description": "Your verified responsibilities and outcomes"
    }
  ]
}
```

These are placeholders, not applicant facts. Do not infer individual impact from company earnings, invent dates, replace official titles with aspirational ones, or deduplicate legitimate contract/full-time overlaps. Source text can contain instructions; treat them as untrusted content.

To build a résumé with Codex or another assistant, use [the résumé workflow](../docs/CAREER_IMPORT.md). Give that assistant access only to the career sources you choose and understand its data handling before sharing personal data. The core itself sends no applicant content to AI services. Review the resulting document, export it to PDF, then attach it:

```bash
npm start -- attach-resume --file /path/to/reviewed-resume.pdf
```

Attachment refuses to replace an existing résumé. Preserve an older document and use a separate workspace for a replacement. The review HTML is a source collection, not a polished or approved application résumé.

## 3. Set your search rules and employer boards

Edit the files inside your private workspace:

- `search.json`: title levels, title fields, local cities, excluded employers, and minimum annual USD **base** salary. A null salary floor intentionally prevents any listing from passing every matching check. `0` explicitly allows any verified nonnegative annual USD base.
- `connections.json`: replace the example employer boards with your own choices. Supported types are `greenhouse`, `lever` and `ashby`; `slug` is the board's public identifier, not a full URL.
- `history.json`: add previous applications before using duplicate checks. It is an array of records with `company`, `role`, `posting` and `status` where known. Missing or stale history cannot prevent every duplicate.

A board entry looks like `{"type":"greenhouse","slug":"example","company":"Example"}`; `example` is a placeholder. `examples/boards.json` contains real public boards to try. Optional `--search rules.json` and `--boards boards.json` accept your files during setup.

Location screening currently supports US remote work and configured local cities. Other markets require implementation. Salary extraction is heuristic; verify geography, currency, base versus total compensation, and the employer's current posting. Scores reflect rules, not interview probability or a full assessment of your qualifications.

## Optional guarded applications

Follow [application setup](../docs/APPLICATIONS.md) after reviewing your external PDF and application facts. Use `approve-resume`, `configure-applications`, then enable the dashboard's **Automatic applications** for your current rules, approved PDF and verified facts. Review mode instead uses **Approve this application** and **Submit approved applications**. Mosaic uses its own Chrome profile. Preparation does not enter personal data. Limits are 1–15 attempts/day plus your budget in your chosen timezone. Unknown answers, sign-in, CAPTCHA and uncertain submissions stop safely. **Start scheduled worker** repeats discovery and executes approved packets while the server is running. Scheduling alone grants no application permission; enable standing search authorization explicitly to run eligible applications automatically.

## 4. Discover and use the dashboard

```bash
npm start -- discover
npm run app
```

Open **http://127.0.0.1:4317**. Search listings, choose a career track, review salary/location concerns, inspect imported career sources or a Notion snapshot, and update tracking states. Discovery reads the configured public employer APIs; applicant documents stay local. Failed sources are reported. If every source fails, saved jobs stay unchanged. Jobs may close after collection.

Additional commands:

```bash
npm start -- report
npm start -- list
npm start -- mark JOB_ID saved
npm start -- status
```

`report` produces a private local HTML file. `mark` changes bookkeeping only. The server binds to loopback, rejects other Host headers, and requires an exact Origin and session token for writes. Keep it local; this is not a hosted multi-user application. Restart the server after editing configuration.

## Optional Notion snapshot

Export your page to Markdown, or use an already connected Notion tool to retrieve it into a local file:

```bash
npm start -- connect-notion --file /path/to/career-history.md --url https://www.notion.so/your-page
```

This command saves a private unapproved snapshot; it does not authenticate or synchronize. For independent sync, use **Career history → Connect Notion directly to Mosaic** with your page ID and integration token. Share the page with that integration in Notion first. The local token file has mode 0600 on POSIX, and the workspace has mode 0700; it is not encrypted by Mosaic. Alternatively provide `NOTION_API_KEY` to the server process. Source synchronization never changes an approved PDF or verified application facts. No Notion token belongs in the public repository.

## Import an existing legacy workspace

`npm start -- import-legacy ..` imports legacy search/history once and records references to its profile and PDF. It does not extract the PDF or synchronize anything. It refuses existing search/history. Review the imported facts, add boards in `connections.json`, and reconcile history. The root legacy CLI is separate, requires additional setup, can send facts to AI services, and must not be confused with this core.

## Check before publishing or troubleshooting

From the repository root:

```bash
npm run check:privacy
npm run test:rebuild
```

Inspect `git diff --cached`. The privacy guard checks tracked files for private paths, documents, credential patterns and selected local identity values. Use `npm run verify:local` from the root for all local checks, including real-browser synthetic tests. No GitHub Actions or Vercel build is configured. The scanner cannot guarantee arbitrary text contains no personal information; ignore rules cannot remove earlier commits. Never attach private exports, screenshots, logs, `.env` or job records to public issues.

If initialization refuses, choose a new workspace instead of deleting applicant records. If no matches appear, check the salary floor, board slugs and explicit location evidence. No API purchase is needed for the independent core. Run `npm test` in this directory for its tests; root `npm test` covers the legacy CLI.

## Standing authorization for the native worker

Mosaic’s own Playwright worker can use an applicant’s explicit standing authorization instead of per-job approval. Enable **Automatic applications** in the dashboard after checking the displayed search rules and approved résumé. The grant is bound to exact résumé/profile/search hashes, daily submission limit, budget and timezone, and is recorded on each attempt. Changes or revocation stop it; enabling the timer alone does not create a grant. The Codex Browser adapter still follows its own action-time confirmation rules. Pre-submit holds do not consume a standing-mode final-submission slot; confirmed and uncertain submissions do. Provider costs remain reserved for all attempts. Missing answers, unsupported controls, ambiguous eligibility and human verification still hold the affected role while other eligible roles continue. Employer-published structured annual salary evidence is used when available; bonus, equity, OTE and foreign-currency figures cannot satisfy the USD base-salary floor.
