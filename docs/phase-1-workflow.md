# Capture to an offline regression test

This CLI workflow tests an intentional duplicate-counting defect in Aftershock's maintained Pump.fun trade sample. It does not claim a defect in the independently maintained external indexer. The external indexer's pinned ordinary decoder supplies supported normalized input; its persistence campaign is later work.

## Requirements

Use the repository's Node version (`.node-version`), pnpm 10.33.0, Linux user/network namespaces and the local Docker daemon at `/var/run/docker.sock`. The exact PostgreSQL image in `compose.yaml` must already be cached. `pnpm db:up` provisions the development service and caches that image during initial setup; the regression runner itself never pulls images. The sample creates separate disposable containers and never uses the development database or `DATABASE_URL`.

The fresh-capture/normalization steps also need Solami credentials in local `.env` and the verified Rust decoder build described in the [integration README](../integrations/solana-realtime-indexer/README.md). Offline execution needs neither credentials nor the Rust executable.

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm build:regression
pnpm capture config/capture.example.json
pnpm capture:normalize .aftershock/captures/<capture-id> /absolute/path/to/solana-realtime-indexer --legacy-v0-only
pnpm campaign .aftershock/normalized/<normalization-id> my-seed
```

Use the actual paths printed by each command. The capture is bounded to 25 transactions, 100 frames, 2 MiB and 10 seconds. The legacy/v0 selection explicitly records excluded v1 transactions. Account mention alone does not establish a trade. The normalizer selects the declared successful Pump.fun CPI TradeEvent family through the pinned external decoder.

The build produces ignored standalone JavaScript bundles and a source snapshot with hashes. Build again after code changes. The recorded Git revision identifies the base revision; source hashes identify actual implementation bytes, including any uncommitted implementation changes. Acceptance evidence should use a build made from a committed implementation.

## What a campaign does

1. Verify the normalized events, raw frames and parent capture manifest.
2. Give the faulty sample a new empty PostgreSQL database and deliver every selected transaction once. A failure here is reported as a baseline failure; the duplicate experiment does not proceed.
3. Select a nonempty transaction from the seed and stable input IDs. Deliver the original sequence plus one extra copy at that anchor, using a new database.
4. Preserve exact event/total discrepancies, the delivery trace, configured faults and acknowledged applied faults. Export is permitted only for the intended aggregate discrepancy.
5. Run the fixed sample both cleanly and with the same duplicate. A successful campaign means the intended sample defect was found and the corrected sample passed; it is not a statement that the faulty run passed.
6. Write the initial unreduced offline export. Reduction belongs to Phase 3.

Both samples keep unique event rows. The faulty sample increments totals on every delivery. The fixed sample increments totals only for newly inserted events. Each delivery's effects and checkpoint commit together in this Phase 1 sample. The separate-checkpoint crash defect and real kill-at-commit hook are Phase 2 work.

Amounts remain integer lamports and token base units. Groups are program/mint/buy-or-sell, not a sum across unrelated tokens or a USD valuation. Identity includes signature, instruction path and event ordinal, so multiple trades in one transaction remain distinct.

## Use the export elsewhere

Copy the entire printed export directory to another directory or machine with the declared runtime/dependencies. It includes bundled code, dependency attribution, source snapshots, schema, normalized inputs, selected original raw messages, expected state, initial empty state, seeded scenario, assertions, parent manifest and hashes. It needs no `node_modules` or package download.

From inside that directory:

```sh
node regression.mjs test . faulty
node regression.mjs test . fixed
node regression.mjs reproduce . faulty
node regression.mjs reproduce . fixed
```

| Command | Meaning | Expected exit |
| --- | --- | --- |
| `test . faulty` | Require correct state; the intentional defect violates it | 1 |
| `test . fixed` | Require correct state; the corrected sample satisfies it | 0 |
| `reproduce . faulty` | Require the recorded failure identity and actual duplicate | 0 |
| `reproduce . fixed` | Require that old defect; it is absent | 1 |

Exit 2 means a runner/setup/integrity error. Exit 3 means required evidence/capability is inconclusive, unsupported or cancelled. A different Node version/platform/architecture is explicitly unsupported. Missing files, invalid hashes, unexpected dependency declarations and mismatched assertions never become a passing test.

The exported command starts in a network namespace with a minimal environment; the adapter gets its own namespace too. PostgreSQL runs with `--network none`, a read-only container root, bounded temporary storage, 256 MiB memory, one CPU and a PID limit. SQL uses only Docker's explicitly declared local Unix socket. The pinned image must already exist locally. Local Docker access is trusted; this is not a security sandbox for arbitrary hostile adapters.

## Inspect the evidence

The campaign directory has `campaign.json` with separate clean/faulty/fixed outcomes. Each attempt retains `result.json`, the versioned `run.json`, `delivery-trace.json`, `discrepancies.json`, initial inputs, committed snapshot/checkpoint and runtime/source references. Failed assertions additionally have `incident.json`. Results of portable commands are under the export's `results/<run-id>` directory.

A trace marks each delivery planned, then durably acknowledged. Required duplicate faults count as applied only when all extra deliveries receive the declared durable acknowledgement. A partial run retains its trace and cannot pass. Normal cancellation closes the child and removes its owned database. An abrupt host/daemon failure can prevent cleanup; that is a runner error and must not be called a consumer defect.

The sample checks ownership both at container and database level. Cleanup targets only its freshly named container after matching the ownership label. No ordinary project database is reset or truncated. Stored trade counts and totals are read from PostgreSQL after drain, not reconstructed by the adapter from expected values.

Limits: up to 1,000 input transactions/10,000 events, 2,000 scheduled deliveries, 120 seconds of consumer execution per attempt, 16 MiB protocol output, 128 MiB locked case bytes, bounded database startup/SQL calls, and fixed cached runtime dependencies. A campaign has four attempts; it does not loop until it obtains a preferred result.

This is an application correctness/duplicate-resilience check for a declared captured selection. Expected values share the external decoder. It does not independently prove decoder correctness, full Solana coverage, universal determinism or crash recovery. Finalized capture membership can be checked separately with `pnpm reference:check <capture-dir> --full-filter` and remains separate from the application verdict.

## Development verification

```sh
pnpm check
pnpm test:regression
```

The first command runs type checking and the unit/protocol/integrity tests. The second builds the standalone runtime and exercises real disposable PostgreSQL, exact large values, multi-event identity, both consumer builds, all four command meanings, relocated offline execution and negative integrity/dependency/baseline cases. CI runs both.
