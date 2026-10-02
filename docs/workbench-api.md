# Evidence workbench, API and worker

The React/Vite workbench drives the maintained trade sample through recording, reference checks, scenarios, incidents, reduction, exports and repeated fix comparisons. Fastify serves the built interface and authenticated API. PostgreSQL keeps projects, immutable case registrations, job identities and progress separately from disposable consumer state. Private external consumer execution remains unsupported; the full external adapter is Phase 5.

## Start locally

Use the [local setup](local-setup.md) prerequisites: exact Node 22.22.2, pnpm 10.33.0, Docker, the cached pinned PostgreSQL image, and Linux user/network namespaces.

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm build:regression
pnpm build:workbench
pnpm control init
pnpm control project "My trade tests"
pnpm control sample <project-id>
```

The last command creates a clearly labelled **synthetic** maintained sample, with no provider access. To register an existing normalized mainnet case instead:

```sh
pnpm control import <project-id> <normalized-directory> my-seed crash
pnpm control capture-import <project-id> <capture-directory>
```

Operator-only imports accept local paths. Browser requests accept IDs and bounded settings. Imported executables must match the current maintained build. Already registered cases retain their original pinned runtime when the build changes. Raw recordings, cases and attempts stay in ignored `.aftershock/workbench/`; the control tables stay in the dedicated `aftershock_control` database.

Run these in separate terminals:

```sh
pnpm api
pnpm worker
```

Open `http://127.0.0.1:8787` and select **Connect runner**. Same-origin loopback pairing creates an eight-hour HttpOnly, SameSite=Strict session. Page refresh restores that session and the hash-based run/case URL. The server also accepts an operator Bearer token for CLI integrations; its 0600 file is `.aftershock/workbench/api-token`. Never put it in URLs, logs, screenshots, chat or tracked files. `/`, static UI assets, `/health` and session status are public; project data and mutations require authentication. Foreign origins are rejected.

For interface development, `pnpm --filter @aftershock/workbench dev` proxies `/api` to the local server. Set the API's `AFTERSHOCK_WORKBENCH_ORIGIN` to the exact development origin, such as `http://127.0.0.1:5173`. The default production build uses the same origin for UI and API.

## Live inputs and references

Live recording uses the runner's local `.env` provider configuration, never browser credentials. Configure Solami according to the [capture workflow](phase-1-workflow.md). Normalization also requires the verified Rust decoder from the [integration setup](../integrations/solana-realtime-indexer/README.md); `AFTERSHOCK_DECODER_BINARY` can identify that local binary. Its hash must match the committed decoder lock. Missing decoder/setup is a runner error. Unsupported v1 input without explicit exclusion is `UNSUPPORTED`.

The browser's Pump.fun filter means successful non-vote transactions **mentioning** the account; it does not establish invocation or swaps. Captures stop at configured time/transaction/byte limits or 200 frames. Fresh receipt counts and last-received timestamps are saved as progress. Sealing verifies byte integrity. Finalized membership is a separate operation: full-filter reconstruction is limited to fewer than four slot increments, and membership checks to fewer than sixteen. Wider or unavailable intervals remain inconclusive. A complete reference does not establish capture completeness; partial boundary matches remain visible.

Normalize after finalization to include the sealed reference and its checksummed RPC response files in the locked case. Finalizing later does not retroactively change an existing immutable case. Normalization records each v1 exclusion explicitly. Consumer execution is replay over saved inputs, even when the recording was collected moments earlier.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /session`, `POST /session` | Read readiness/session status and establish protected browser access |
| `GET /capabilities` | Maintained adapter capabilities, variants and limits |
| `GET /projects`, `POST /projects` | List/create projects |
| `GET /projects/:id/captures` | Sealed recording manifests and separate finalized reference summaries |
| `GET /projects/:id/cases`, `GET /cases/:id` | Immutable case library, contract, input, reduction and reproduction history |
| `GET /cases/:id/sources/:inputId` | Checksummed original source bytes (base64), labelled synthetic or protobuf, signature, slot and decoded business-event identities |
| `GET /projects/:id/runs`, `POST /runs` | List jobs or schedule a typed bounded operation |
| `GET /runs/:id`, `POST /runs/:id/cancel` | Saved job/result and cancellation |
| `GET /runs/:id/events?after=N`, `GET /runs/:id/stream` | Durable cursor-based progress and SSE reconnect |
| `GET /runs/:id/incident` | Proven assertion failure, fingerprint, discrepancies and source provenance |
| `GET /runs/:id/artifacts/:artifactId` | Whitelisted JSON evidence with checksum verification |
| `GET /runs/:id/download` | Checksummed portable case archive for a successful export job |

Every operation body includes `projectId`, `idempotencyKey` and an optional `maxSeconds`. The request key is 8–100 letters, digits, underscores or hyphens. Identical settings return the same durable ID; conflicting reuse returns 409. IDs must belong to the project. Unknown fields, executable paths and adapter uploads are rejected.

| `kind` | Other settings | Meaning |
| --- | --- | --- |
| `campaign` (default) | `caseId`, `variant: faulty \| fixed`; 10–360 seconds | Clean baseline, then the case's faulted assertion; confirmed faulty failures create a sealed case |
| `capture` | `durationSeconds: 1–30`, `maxTransactions: 1–100`, `maxBytes: 1024–4194304`, `commitment` | Bounded live mainnet recording |
| `reference` | `captureId` | Finalized membership, and full-filter reconstruction when bounded enough |
| `normalize` | `captureId`, **required** `allowV1Exclusions`, `seed`, `preset` | Verified decoder, supporting reference files and initial scenario case |
| `scenario` | `caseId`, `seed`, `preset` | New immutable scenario over the same inputs |
| `reduce` | Confirmed `caseId`, `maxAttempts: 2–20` | Preserve fingerprint, dependencies and fault anchors; save reduced case on verified success |
| `compare` | Confirmed `caseId`, `repeats: 1–5` | Finite fresh-state pairs of pinned faulty/fixed variants |
| `export` | Confirmed `caseId` | Locked portable offline archive and instructions |

Presets are `crash`, `duplicate`, `disconnect`, `temporary-omission` and `permanent-omission`. Only the supported anchored configurations are executable. Arbitrary mid-statement crashes are unsupported. Permanent omission remains inconclusive.

`COMPLETED` is a job state, not a correctness verdict. Results distinguish `PASS`, `FAIL`, `INCONCLUSIVE`, `UNSUPPORTED`, `RUNNER_ERROR` and `CANCELLED`. A failed application assertion is an incident; a process/setup error is not evidence of a consumer defect. Coverage and finite reproduction confidence remain separate. Exact amounts use decimal integer strings; unrelated mints remain separate.

## Ownership and bounds

Global limits: 20 queued/running jobs, two unexpired worker leases, 100 projects, 100 registered recordings, 200 cases and 2,000 saved jobs. Queue admission, claims and registrations use transaction locks. Claims use `SKIP LOCKED`, a 15-second lease renewed every two seconds, and fenced generations. Progress, derived-case/reference registration and final results require current ownership under a row lock. Lost ownership aborts active work. Recovery always gets a new directory and fresh owned consumer databases; two workers never attach to the same mutable consumer state.

Saved-input jobs allow at most three attempts. An expired live recording becomes `INCONCLUSIVE` without automatically subscribing again: new live inputs would be a different recording. Cancelled work cannot publish a new derived case. Prior attempt evidence remains local. No automatic deletion occurs.

Operation budgets are 10–1,200 seconds (campaigns at most 360), with existing engine limits and up to 90 seconds of cleanup grace. Live setup has a separate 50-second deadline. Each sample container retains the engine's network, CPU, memory, PID and temporary-storage limits. Cases/archives are capped at 32 MiB; public JSON artifacts at 16 MiB. Reference reads retain their existing 16/64-MiB response budgets. Reduction is capped at 256 MiB and 20 attempts. Requests are 8 KiB; histories 128 events; SSE streams 16 connections, each at most 30 seconds with resumable event IDs. The browser uses SSE plus cursor polling to restore final state after reconnect.

Storage admission uses a 1-GiB cap and 128-MiB reserve; active workers monitor storage every two seconds and abort near the cap. This is bounded application supervision, **not a hard filesystem quota**. Use a dedicated bounded durable volume for hosted operation. Retention/backup operations and sustained service reliability remain later operational work. The trusted Docker host is an explicit dependency, not a hostile-code sandbox.

## Hosted samples and connected local execution

`AFTERSHOCK_WORKBENCH_MODE=hosted-samples` requires an exact HTTPS `AFTERSHOCK_WORKBENCH_ORIGIN`, enables binding on `0.0.0.0:8787`, and requires the operator-issued token for pairing. Sessions use Secure cookies. An HTTPS reverse proxy and private durable storage/control database are operator prerequisites. This mode serves the same maintained sample engine; no remote consumer code upload exists. The access token, origin checks and global job/resource caps protect job creation. The browser offers the synthetic sample or operator-registered recordings according to the server's library.

The Runner screen opens the workbench at `http://127.0.0.1:8787` for connected local execution. The local UI, recordings and runner stay on that machine; no private code is uploaded to the hosted service. The maintained adapter works here today; arbitrary private external adapters remain Phase 5. These paths are implemented and tested without claiming an actual public deployment. Deployment is Phase 6.

`AFTERSHOCK_CONTROL_URL` must identify the dedicated database `aftershock_control`; `AFTERSHOCK_WORKBENCH_STORAGE` may identify a private durable volume. Keep both settings and provider credentials server-side.

Run `pnpm check`, `pnpm build:workbench`, `pnpm test:regression` and `pnpm test:control`. The integrations use fresh control test databases and disposable sample containers. CI runs all four checks. See the [Phase 4 report](phase-4-report.md) for measured browser acceptance and limitations.
