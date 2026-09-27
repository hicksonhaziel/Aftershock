# Phase 1 acceptance report

**Phase 1 is complete for the declared Pump.fun legacy/v0 CLI workflow.** A fresh Solami mainnet capture ran through clean baseline → intentional duplicate failure → initial portable export → offline faulty failure and fixed pass. This is not completion of Aftershock's later crash, reduction, external-persistence or workbench phases.

Implementation revision: **`24b1f8b`**; the full exact revision and receipt hashes are in [phase-1-validation.json](phase-1-validation.json). Commands, dependencies and limits are in the [workflow guide](phase-1-workflow.md).

## Fresh source and scope

The capture started on **September 27, 2026 at 22:36:31.998 UTC**, recording 25 transactions in slots **451132920–451132921**, with 26 frames and 160,053 raw bytes. Capture ID: `b65159a0-3812-408a-9a6a-eae1e9cd373d`.

A separate finalized full-filter reference found all 25 captured transactions: zero absent and zero unresolved. The available full blocks contained 39 filter matches; 14 were not recorded by the transaction-limited capture. That does not establish provider loss or complete capture coverage. Reference ID: `84147a00-a3dc-45c0-ab4e-a9123e7771b9`.

The pinned ordinary external decoder produced **19 trade events from 19 selected legacy/v0 transactions**. Six v1 transactions were explicitly excluded with source identities retained. The decoder ran with networking disabled. Expected trade values share that decoder, so this is not independent decoder correctness evidence.

## Campaign result

Campaign ID: `1d014d18-40da-46b3-9d61-28ac84eeaf3e`; seed: `phase1-fresh`. Each attempt used a fresh owned PostgreSQL container, inspected committed state after drain, verified reset back to empty state, and removed its container.

| Sample and delivery | Deliveries | Unique trade rows | Result |
| --- | --- | --- | --- |
| Faulty, clean | 19 | 19 | PASS |
| Faulty, one repeated transaction | 20 | 19 | FAIL, intended aggregate defect |
| Fixed, clean | 19 | 19 | PASS |
| Fixed, same repeated transaction | 20 | 19 | PASS |

The buggy sample's affected group had these concrete discrepancies:

| Field | Expected | Actual | Excess |
| --- | --- | --- | --- |
| Trade count | 1 | 2 | 1 |
| SOL lamports | 10,564,641 | 21,129,282 | 10,564,641 |
| Token base units | 376,266,103,646 | 752,532,207,292 | 376,266,103,646 |

The excess SOL is **0.010564641 SOL**. The required duplicate was durably acknowledged in both faulted runs. Event presence, fields and uniqueness remained correct; the faulty totals were wrong. This is an intentional Aftershock sample defect, not a claim about the external indexer.

## Offline result

The export from that same fresh-data campaign was copied outside the repository and executed with a minimal environment containing no provider credentials. It needed no workspace packages or Rust decoder. The bundled runner and adapter disabled networking; the database used `--network none` and an already cached immutable PostgreSQL image through the declared local Docker socket.

| Offline command | Consumer outcome | Command exit |
| --- | --- | --- |
| `test . faulty` | FAIL | 1 |
| `test . fixed` | PASS | 0 |
| `reproduce . faulty` | Recorded defect reproduced | 0 |
| `reproduce . fixed` | Recorded defect absent | 1 |

All four attempts verified reset and removed their own database containers. The copied evidence was subsequently preserved in ignored local storage. An export credential scan passed. Raw captures, exports, credentials and private plans were not published.

## Verification and exit gates

- `pnpm check`: **71 tests passed**, with type and formatting checks passing.
- `pnpm test:regression`: **two integration tests passed**, covering real PostgreSQL, large integer precision, multiple events in one transaction, baseline/fault separation, both sample builds, all four portable command meanings, corruption, empty evidence and an undeclared network dependency.
- Supervisor tests cover network/environment isolation, lifecycle, request correlation, time/output limits, hash/path enforcement and ownership-token rejection.
- Existing capture tests cover raw-byte preservation and corrupted compressed chunks; normalization tests cover unsupported/incomplete decoder evidence and exact values.
- [Implementation CI passed](https://github.com/hicksonhaziel/Aftershock/actions/runs/36356955623), including frozen installation, namespace preflight, both test suites, database setup/check and cleanup.
- No `aftershock-case-*` containers remained after acceptance verification.

The first external adapter work is the pinned finite decoder/observation bridge, with source and patch identities. The external project's persistence adapter and conclusive campaign are not claimed complete.

## Limits and next phase

The portable case targets Linux, the recorded exact Node version and architecture, a local Docker daemon and a cached pinned PostgreSQL image. It fails explicitly for unsupported runtime/dependency conditions. It is an initial unreduced case; one supported capture is not universal determinism or chain completeness.

Phase 2 adds actual process termination at an observed durable-commit barrier, restart/recovery and checkpoint evidence. The Phase 1 sample's duplicate test does not substitute for that crash test. Reduction, a workbench, external persistence campaigns and deployment remain later work.
