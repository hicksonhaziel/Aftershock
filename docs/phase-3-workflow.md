# Reduce a failure and compare the correction

Phase 3 operates on the maintained trade sample's immutable saved-input cases. It removes whole transactions, retains declared prerequisites and stable fault anchors, rebuilds expectations for the retained subset, and accepts a candidate only after the same failure occurs in a fresh disposable database. It does not alter the original capture or source case.

## Commands

Build the standalone runtime and create a new confirmed case using a saved normalized capture:

```sh
pnpm build:regression
pnpm campaign .aftershock/normalized/<id> phase2 crash .aftershock/references/<id>
pnpm reduce .aftershock/campaigns/<id>/case
pnpm compare .aftershock/campaigns/<id>/case .aftershock/reductions/<id>/case
pnpm export .aftershock/comparisons/<id>/case-1 /absolute/new-export-directory
```

`reduce` accepts optional attempt, time and retained-artifact scheduling budgets:

```sh
pnpm reduce <case-directory> 20 900 536870912
```

Defaults: 20 attempts, 900 seconds and 512 MiB. Hard configuration bounds: 64 attempts, 3,600 seconds and 1 GiB. The engine reserves space for copied inputs, a complete run and its proof before scheduling work; a budget too small to fit that reserve returns inconclusive and preserves the original. Candidate copies and run evidence are retained under the operation directory. Cancellation stops the active runner, lets it clean up, retains completed evidence and preserves the original case. Cleanup can take up to 90 seconds after the operation deadline before the supervisor forces process-group termination; an unverified cleanup cannot pass.

The candidate search first tries large removals, then smaller groups. A final fresh run rechecks the selected case. If the budget runs out, an unresolved attempt occurs or final reproduction fails, the report preserves those outcomes and avoids an unsupported minimality claim. An unsuccessful final check falls back to the original case. `PASS` means the selected case reproduced the specified failure; it does not mean the intentionally faulty consumer is correct.

`compare` takes one to four case directories and runs **five faulty and five fixed attempts for each**, all from fresh owned database state. It executes the exact standalone runtime inside each case, with its pinned Node/platform/architecture/PostgreSQL requirements. The report records every attempt; it cannot count a missing or untriggered crash as a fixed pass. A successful pair is five same-failure reproductions and five fixed passes. An observed fixed assertion failure is a comparison failure; unresolved runs remain inconclusive. The operation stops scheduling after one hour or its 1 GiB storage reserve limit. The two maintained sample variants are pinned configurations of the same adapter artifact; this command does not check out arbitrary Git revisions.

## What stays unchanged during reduction

- A transaction is indivisible: all its business events remain together. Repeated deliveries of the same signature belong to the same removable group.
- The crash targets the original stable event identity, not a renumbered delivery offset. Duplicate/disconnect anchors likewise retain their input IDs.
- Optional `prerequisites` declare preceding inputs needed by another input, with a reason. `retainedInputs` declare mandatory initialization/control inputs. Missing, cyclic or nonpreceding prerequisites are rejected. Transitive requirements and transaction companions are kept.
- The initial-state artifact, recorded supporting evidence, runtime/source hashes, assertion implementation and configured fault stay pinned.
- Parent capture ID/hash, original source sequence numbers, source interval and explicit exclusions remain attached. The reduced assertion is labelled as a subset, not as a full-interval reference comparison.

The current normalized trade adapter receives transactions, not live heartbeat/control messages. The parent manifest retains the original control-frame context; no decoder or stream-control replay is claimed. Future adapters that need executable initialization/control frames must represent them as required units or extend the contract. The current consumer needs no online enrichment: its only uncontrolled dependencies are host scheduling and the explicitly declared local Docker service.

## Failure identity and evidence

The failure fingerprint includes the assertion, projection, stable fault configuration, affected group, discrepant field and excess/deficit direction. It excludes expected totals, because deleting unrelated legitimate trades changes those totals. The reducer also requires the same discrepancy-field set, required faults applied, verified initial state, successful reset and owned cleanup. A different error or a nonzero runner exit never substitutes for the target failure.

Every attempt records source revision, implementation and variant digests, runtime/input/scenario hashes, initial-state digest, actual delivery/recovery traces, discrepancy and snapshot hashes, verdict, fingerprint and fault application. The consolidated `history/` directory copies a strict evidence whitelist: no ownership configuration, credentials or arbitrary logs. Each attempt and evidence file is included in the runtime lock. The reduction proof contains original/retained transaction and raw-byte counts, removed IDs, retained-prerequisite reasons, candidate decisions, budget use and final run ID.

“1-minimal under declared transaction units” means no allowed single transaction-group removal remained after the measured search. If only the mandatory crash transaction remains, the contract itself prevents removing it. This is not a globally smallest reproducer or a claim that every alternate schedule was explored. Five successful attempts measure repeatability; they do not establish universal determinism.

## Portable regression and compatibility

Use the exported runtime itself:

```sh
node /absolute/export/regression.mjs reproduce /absolute/export faulty
node /absolute/export/regression.mjs test /absolute/export faulty
node /absolute/export/regression.mjs test /absolute/export fixed
```

Expected exits: reproduction on the faulty build `0`; correctness test on faulty `1`; correctness test on fixed `0`. Runner/setup failure is `2`; inconclusive, unsupported or cancelled is `3`. Reproducing on the fixed build returns `1` because the old failure is absent.

The export includes checksummed inputs/expectations, source and runtime locks, initial state, assertion implementation, reduction proof and recorded attempt history. The export manifest has its own checksum, and the reader validates its links back to the runtime lock. Missing files, altered evidence, unsupported runtime versions and undeclared online dependencies fail explicitly. Hashes detect accidental changes; they are not signatures against someone replacing both content and hashes.

Phase 1/2 exports remain executable with their original bundled runtimes. They do not contain the stronger Phase 3 fingerprint/history contract; create a new confirmed case with the current build before using Phase 3 reduction/comparison. The current reader explicitly rejects an older export manifest without its checksum rather than silently treating it as a current export.

All captures, case histories and exports remain local by default. The commands do not make provider requests, trade tokens or submit Solana transactions.
