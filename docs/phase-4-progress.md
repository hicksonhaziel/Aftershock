# Initial Phase 4 backend milestone

Historical record of the first backend milestone on 2 October 2026. The subsequent full workbench acceptance is in the [Phase 4 report](phase-4-report.md); use that report and the [current setup/API guide](workbench-api.md) for present capabilities. The sections below describe what was implemented and still pending at this earlier milestone.

The API can save projects, list locally imported cases, queue a maintained sample campaign, retain progress, cancel work, and return an incident with exact discrepancies and checksummed evidence. Each job first runs its selected sample variant without injected faults. A failed baseline stops that job before fault injection. A passing baseline unlocks the configured faulted run. `FAIL` means an application assertion failed; it does not mean the worker failed. Faulty and fixed variants are separate jobs over the same immutable case.

The persistent control database is separate from disposable consumer databases. Competing workers claim jobs transactionally. A claim has a lease and an increasing attempt number. Renewals, progress and final publication require the current worker, attempt and unexpired lease. Recovery copies the immutable case into a new attempt directory and creates fresh consumer state; it never attaches another worker to the interrupted attempt's database. Stale processes can retain their own bounded attempt evidence locally, but cannot replace the current job's result. Retries are limited to three attempts.

The engine executes the exact bundled runtime registered with each case. A new `baseline` runtime command executes the clean lane without changing the ordinary `test` and `reproduce` meanings. The import gate accepts the locally built maintained sample's runner, adapter and migrations. Browser requests contain case IDs and bounded settings, with no executable paths or consumer uploads.

## Verification

`pnpm check` passed strict type checking and **80 unit/protocol/integrity tests**. `pnpm test:control` passed **six PostgreSQL/API/worker integration tests**:

- Concurrent claims, idempotent requests, conflicting request keys, expired leases, stale publication rejection, bounded retries and queued/active cancellation.
- Global queue and active-lease limits under competing workers.
- Authenticated API access, origin/body/settings checks, saved IDs after reopening the API and database connection, and SSE reconnection from a saved cursor.
- Actual clean/faulted engine execution, real consumer `SIGKILL`, unique rows alongside incorrect totals, fixed sample pass and rejection of changed evidence.
- Lease loss during actual execution, different database/container ownership for recovery, rejection of the old worker's result and owned cleanup.
- User cancellation of actual active execution, retained inspectable evidence and owned cleanup.

`pnpm test:regression` also passed all **five existing PostgreSQL/offline integration tests**. CI now runs the new control suite as well; these are local results until the pushed commit's CI finishes.

Synthetic test inputs are labelled as such. Separate saved-mainnet acceptance used the real localhost HTTP API and a separately running worker process, with the September 27 capture `b65159a0-3812-408a-9a6a-eae1e9cd373d` and its unchanged manifest hash `1ac0780d388854935fca9a2c1276fe7744fdcdcbe31f3a142d52154f3c40c83e`. Both clean baselines passed. The faulty job failed after the actual crash; the fixed job passed, with the required crash applied and owned cleanup verified in both. Both retained 19 unique trade rows. The faulty totals showed the expected excess of one counted trade, 19,082,820 lamports and 1,351,089,180,462 token base units after overlap on `source-18`.

This is two measured faulted attempts, not a new five-repeat fix comparison or a fresh live capture. Coverage remains unassessed and six v1 exclusions remain explicit. No provider requests were made. The [backend validation receipt](phase-4-backend-validation.json) contains IDs/hashes and bounded outcomes; full recordings, credentials and the detailed HTTP receipt remain local. The build recorded its pre-commit base revision plus actual implementation/source digests. Browser capture-to-fix acceptance has not been performed.

## Remaining Phase 4 work

Next, connect the React/Vite workbench to these saved jobs and evidence. Complete capture controls and finalization, campaign configuration and capability validation, scenario/consumer matrix, incident source and commit/checkpoint views, reduction and history, exports, repeated fix comparison and the case library. Add the hosted maintained-sample and connected local runner paths, accessibility, deployment-ready resource controls, and complete browser capture-to-fix/reconnect acceptance. The current services bind to localhost and share an operator token; they are not a deployed multi-user service.

The existing CLI still provides capture, normalization, reduction, exports and repeated comparisons. This initial API slice does not expose those operations yet. Full external integration, the second sample and sustained reliability remain Phase 5; deployment and submission remain Phase 6.
