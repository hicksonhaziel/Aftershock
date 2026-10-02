# Local campaign API and worker

This is the initial Phase 4 backend, using the existing maintained trade sample engine. There is no browser workbench yet. Private consumer uploads and arbitrary code execution are unsupported.

## Start locally

Use the [local setup](local-setup.md) prerequisites: exact Node 22.22.2, pnpm 10.33.0, Docker, the cached pinned PostgreSQL image, and Linux user/network namespaces. No provider credentials or new requests are needed for a saved-input campaign.

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm build:regression
pnpm control init
pnpm control project "My trade tests"
pnpm control import <project-id> <normalized-directory> my-seed crash
```

The project and import commands return IDs. A normalized directory comes from `pnpm capture:normalize`; see the [CLI workflow](phase-1-workflow.md). The default import scenario is `crash`; `duplicate` is also selectable. Only cases matching the current maintained build are accepted. Rebuilding requires a new import if executable hashes changed; already registered cases keep their original pinned runtime.

Run these in separate terminals:

```sh
pnpm api
pnpm worker
```

The API listens on `127.0.0.1:8787`. Job tables live in the `aftershock_workbench` schema of `aftershock_control`, on the persistent development volume. Cases and attempt evidence live under ignored `.aftershock/workbench/`. The random API token is saved there as `api-token` with mode 0600. All routes except `/health` require `Authorization: Bearer <token>`. Do not paste the token into browser URLs, chat, logs or tracked files. The services do not load provider `.env` into consumer processes.

For a local API request without printing the token, save and run the following Node script inside the repository, using your project/case IDs:

```js
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const response = await fetch("http://127.0.0.1:8787/runs", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + readFileSync(".aftershock/workbench/api-token", "utf8").trim(),
  },
  body: JSON.stringify({
    projectId: "<project-id>", caseId: "<case-id>", variant: "faulty",
    maxSeconds: 360, idempotencyKey: randomUUID(),
  }),
});
console.log("HTTP status:", response.status);
if (response.ok) console.log("Saved job ID:", (await response.json()).id);
```

## Routes and meaning

| Route | Purpose |
| --- | --- |
| `GET /health` | Local service readiness; no database or engine correctness claim |
| `GET /capabilities` | Supported maintained variants/scenarios and current limits/gaps |
| `GET /projects`, `POST /projects` | List/create projects for the maintained adapter |
| `GET /projects/:id/cases` | Imported case IDs, provenance, coverage and hashes |
| `GET /projects/:id/runs` | Recent persistent jobs |
| `POST /runs` | Queue clean baseline followed by faulted application assertion |
| `GET /runs/:id` | State, attempt, verdict and published evidence references |
| `POST /runs/:id/cancel` | Cancel queued work or ask the owning worker to stop/clean up |
| `GET /runs/:id/events?after=N` | Saved progress and the next per-job cursor |
| `GET /runs/:id/stream` | SSE progress; resume using `Last-Event-ID` or `after=N` |
| `GET /runs/:id/incident` | Failed assertion, fingerprint, exact discrepancies and provenance |
| `GET /runs/:id/artifacts/:artifactId` | Whitelisted JSON evidence with hash verification |

Create a project with `{ "name": "My tests", "adapter": "maintained-trade-ledger-v1" }`. Job bodies accept only project/case ID, `faulty` or `fixed`, a 10–360 second budget, and an 8–100 character request key using letters, digits, underscores or hyphens. Reusing the key with identical settings returns the same durable ID; different settings return 409. Unsupported settings and code paths are rejected before scheduling. A case must belong to its project.

Job state and verdict are separate. `COMPLETED` can carry `PASS`, `FAIL`, `INCONCLUSIVE`, `UNSUPPORTED` or `RUNNER_ERROR`; a cancelled job carries `CANCELLED`. The selected sample's baseline and faulted results remain separate. Permanent omission stays inconclusive. Coverage, explicit exclusions, capture ID/hash, source interval and integer units remain attached. A saved mainnet recording is labelled replay, and intentional sample defects are not attributed to the external indexer.

SSE connections last at most 30 seconds and reconnect from the last event ID. Up to 16 progress streams are allowed. Clients may use the cursor-based JSON endpoint instead; job identity and history do not depend on an open connection. Every evidence download rechecks its checksum. Ownership config, tokens, executable files and arbitrary paths are excluded from the evidence API. Full raw chunks remain local; the input/manifest records expose exact references for the future source viewer.

## Ownership and limits

At most 20 queued/running jobs and two unexpired worker leases are admitted globally. Claims use a transaction with row locking and `SKIP LOCKED`, a 15-second lease and a new generation. Workers renew every two seconds. A lost lease stops work; every progress/publication mutation verifies worker ID, generation and lease under a row lock. Three expired attempts end as a runner error, with local evidence retained. Each generation has its own exclusively written case/evidence directory and every execution creates a new owned PostgreSQL container. No recovery reuses interrupted mutable consumer state.

Execution has a 360-second job budget plus up to 90 seconds of cleanup grace. The existing scenario/runtime enforce their own shorter limits and network isolation. Each consumer database retains its existing 256-MiB memory, one-CPU, PID and temporary-storage limits. The worker and API themselves run on the trusted local host; this is not a hostile-code sandbox.

Cases are capped at 32 MiB. Storage admission is capped at 1 GiB with a 128-MiB per-attempt scheduling reserve. This reserve is not an operating-system filesystem quota; retained evidence can consume the reserve, and complete retention/backup/quota supervision remains open. Projects/cases are capped at 100/200, request bodies at 8 KiB, and job event histories at 128 entries. No automatic deletion of captures or prior attempts occurs.

The local defaults need no additional environment values. For a dedicated remote control database, server-side `AFTERSHOCK_CONTROL_URL` must identify database `aftershock_control`; `AFTERSHOCK_WORKBENCH_STORAGE` can point to a private durable volume. Those settings do not turn the localhost services into a hosted deployment. Never point control storage at disposable consumer state. Keep all private storage and credential files outside versioned artifacts.

Run `pnpm test:control` after `pnpm db:up`. It builds the bundled engine, uses freshly named control test databases, runs real isolated samples, and drops only its own test state. CI also runs it. PostgreSQL queue locking follows [the PostgreSQL 15 locking documentation](https://www.postgresql.org/docs/15/sql-select.html); the API uses [Fastify 5](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/).
