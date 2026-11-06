# TeachMate architecture

TeachMate is a local Next.js application. Its React workspace calls server-side route handlers; Prisma stores the class roster, source files, assessment inputs, runs, task states, tool results, issues, results and output versions in SQLite. Uploaded file bytes remain in the database and are served only through authorised download routes.

## Work and review

The workflow engine progresses through **Goal → Plan → Act → Check → Correct → Deliver**. A persisted plan records task dependencies and completion criteria. A typed, allowlisted registry validates tool arguments and results. The planner cannot introduce a new executable tool, and learner responses are assessment data rather than tool instructions.

Workers extract supported documents, validate the rubric and roster, assess each response, compile a gradebook and prepare reports. Deterministic checks validate criterion coverage, score bounds, quoted evidence, totals and percentages. A separate model review in live mode supplies additional review flags; it does not certify a mark as correct. Recoverable failures receive at most two correction attempts. Unresolved cases remain visible for teacher judgement while independent tasks continue.

SQLite uniqueness constraints prevent duplicate gradebook entries. Teacher edits create audited output versions and remain protected during regeneration. Approval and publication are separate actions. Learners receive only their own published results; drafts and other learners' results remain inaccessible through server-side checks.

## Two explicit modes

- **Demo:** deterministic, simulated assessment fixtures. The seeded assessment contains ten fictional learners, varied responses, a confirmed blank response, an ambiguous answer and a duplicate-upload scenario. A labelled fault injection deliberately changes an intermediate total so the reviewer and corrector can be demonstrated.
- **Live:** server-side calls through an OpenAI-compatible provider adapter. API credentials, base URL and model are environment variables. Learner identifiers are pseudonymous in requests and names are attached locally. Missing credentials or a model error never cause a fallback to demo marks.

Activity messages come from persisted backend events and describe actions and outcomes. They do not expose hidden model reasoning. Tool and model call budgets, run duration limits and persisted cancellation constrain execution.

## Access and storage

Session cookies authenticate users. Every class, assessment, result, export and document operation is scoped to the teacher's assigned classes or a learner's own published results. The supplied demo credentials identify synthetic users and must be disabled before using real data. Assessment deletion cascades to its source files, runs, issues and generated output records.

The local worker runs in the Next.js process. Production hosting needs a durable background job queue and worker so runs survive restarts, along with managed identity, retention policy, encryption, backups and operational monitoring. The application is an MVP for teacher review, not an unattended release system.

## PostgreSQL path

Change the Prisma datasource provider from `sqlite` to `postgresql`, set a PostgreSQL `DATABASE_URL`, generate a fresh PostgreSQL migration history in a separate branch/environment, and migrate data with a reviewed export/import. SQLite migration SQL cannot be applied directly to PostgreSQL. Re-run the integration and authorisation tests against the new database before deployment. Uploaded bytes can move from the `Document` table to private object storage while retaining the same authorised download API.
