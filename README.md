# TeachMate — Your Digital Teaching Colleague

A working local full-stack application for **create assessment → upload → plan → mark → check → correct → teacher approval → publish → export**. Built with Next.js App Router, TypeScript, Tailwind CSS, Prisma and SQLite. All marking is a suggestion until a teacher approves it.

## Run locally

Use Node.js 22 LTS and npm. From this directory:

```sh
npm install
cp .env.example .env
npm run setup
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Open **http://127.0.0.1:3000**. The setup command generates Prisma, applies the tracked migration and idempotently seeds the fictional class. The migration helper creates an absent SQLite file before applying migrations, including on Windows. It never replaces an existing database.

This workspace also has a checksum-verified portable Node runtime in the ignored `.tools` directory. For this machine, prepend it to PATH before running npm:

```powershell
$env:PATH = "$PWD\.tools\node-v22.23.4-win-x64;$env:PATH"
npm.cmd run dev
```

Synthetic demo accounts share the password **`TeachMate-demo-2026`**:

| Role | Email |
| --- | --- |
| Teacher | `teacher@teachmate.local` |
| Learner Amara | `learner01@teachmate.local` |
| Other learners | `learner02@teachmate.local` … `learner10@teachmate.local` |

Demo sign-in requires `DEMO_AUTH="true"`. Seeding uses fictional people only. These shared accounts are for local demonstration, and are not a production identity system.

## Demo and live marking

Choose the mode explicitly for each assessment. **Simulated demo** uses deterministic fixtures and makes no model requests. The seeded reading assessment contains ten learners, varied responses, a confirmed blank, an ambiguous answer, a duplicate upload and a clearly labelled incorrect-total fault injection. The activity feed records the intentional injection, reviewer detection and deterministic correction. Custom demo material receives conspicuous simulated placeholders with a blocking teacher-judgment issue.

**Live mode** makes genuine server-side calls to the configured OpenAI-compatible Chat Completions endpoint. Set `LLM_API_KEY`, `LLM_MODEL` and optionally `LLM_BASE_URL` in `.env`, restart the server and select Live when creating the assessment. The adapter requires JSON-object response support and `max_completion_tokens`; the model must support those options. Credentials never reach the browser. Missing credentials or provider failures never fall back to simulated marks. Live model correctness still needs teacher review. Real external model calls require your credentials and were not exercised during local verification.

Budgets are configurable: `MAX_RUN_SECONDS`, `MAX_TOOL_CALLS`, `MAX_MODEL_CALLS` and optional `MAX_MODEL_TOKENS`. Each task receives an initial attempt and at most two corrections. Call counters and task attempts persist across retries. Cancellation stops unfinished work and retains completed drafts.

## Input formats

Paste the questions, rubric and individual responses, or upload UTF-8 TXT and text-based PDF files (5 MB each, 60,000 extracted characters). Empty, damaged, encrypted or partly unreadable PDFs are blocked and explain the need for text or OCR. Scans and handwriting are not recognised. Processing failures never become zero marks.

Use one rubric criterion per line with an explicit maximum:

```text
Understanding | 4 | Explains the lesson about cooperation accurately.
Evidence | 4 | Supports the interpretation using two relevant details.
Expression | 2 | Writes in clear, connected complete sentences.
Total: 10
```

Criterion JSON is also accepted. Live mode can parse other explicit rubric formats, then validates the parsed schema and maximum.

Submission CSV uses **`learner_id,response,status`** headers; `status` is optional and accepts `received`, `blank` or `missing`. Use the IDs displayed in the class roster (e.g. `learner-01`). An empty CSV response is an explicit blank unless marked `missing`. Roster CSV uses **`learner_id,name,email`**, with email optional; it validates membership against the assigned class and does not provision accounts. Duplicate uploads retain the first answer and produce an issue, not a duplicate gradebook row. Imported source text is authoritative while its upload is attached; detach the upload before replacing extracted text.

## What is implemented

- Dashboard and assigned-class roster from stored data; assessment creation and validation preview.
- Persisted six-stage workflow, dependency plan, typed allowlisted tools, real activity events, task attempts, issues, tool results and output versions.
- Criterion-level marks, exact response evidence, justifications and uncertainties; deterministic arithmetic, coverage, bounds and evidence checks plus separate live review.
- Side-by-side review desk, audited teacher edits, individual and eligible batch approvals, revision requests and explicit publication inside the app.
- Gradebook, score distribution, criterion performance and assessment-supported observations; approved CSV and printable individual reports.
- Teacher class scoping, learner-only published feedback, private source downloads, hashed session cookies and password hashes, origin checks and assessment deletion with cascading file/output deletion.
- Retry without duplicate marks, preserved teacher decisions, bounded corrections and cancellation.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Core tests create and remove an isolated SQLite database. Browser tests start a separate server on port 3100 with their own database and Next.js output directory. They use Playwright's Chrome channel; install Chrome, or configure a locally installed browser in `playwright.config.ts`. No API credentials are needed. The live-provider failure tests use a local mock server to verify malformed-output retries and limits without claiming external AI verification.

## Architecture and demonstration

See [architecture](docs/architecture.md) for the server, persistence, access boundaries and PostgreSQL migration path, and the [three-minute walkthrough](docs/demo-walkthrough.md) for a complete demonstration.

The key implementation files are `prisma/schema.prisma`, `lib/workflow.ts`, `lib/tools.ts`, `lib/provider.ts`, `lib/extraction.ts`, `lib/auth.ts` and `app/api/[...path]/route.ts`. Uploads and generated records are private database records. Run events describe actions, evidence and outcomes rather than hidden model reasoning.

## Remaining limitations

The local worker executes inside the Next.js process. A server restart interrupts active work; a durable queue and worker are needed for production. SQLite and bounded batches suit local demonstrations. No OCR, handwriting recognition, external email, institutional SSO, account provisioning or cross-assessment learning diagnosis is implemented. Source corrections can be supplied in a new assessment; saved teacher results can be edited in the review desk. Production use needs managed identity, operational job recovery, appropriate data retention and infrastructure protections. A second model review is an aid, not proof of marking accuracy.

For PostgreSQL, change the Prisma datasource provider, supply its connection URL, create a fresh PostgreSQL migration history in a separate environment and perform a reviewed data migration. Re-run the workflow and permission tests; SQLite migration SQL is not portable directly. The architecture document describes moving file bytes to private object storage while preserving authorisation.
