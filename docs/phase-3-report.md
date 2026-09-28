# Phase 3 acceptance: reduction and repeated fix comparison

Validation date: 28 September 2026. Implementation: `0935acd0fcc032b2cccbe0dbcd937c4b2460cd99`. This phase completes reduction, portable evidence and repeated comparison for the maintained trade sample's declared CLI scope. The workbench and full external adapter remain later phases.

## What the example demonstrates

The saved Solana recording contains 19 supported trade transactions. Aftershock stops the intentionally faulty sample after it saves one trade, restarts it and repeats the saved input. Its trade rows remain unique, but its totals count that trade twice. The corrected sample commits progress with its effects and does not count the repeated trade twice.

The reducer removed 18 unrelated transactions. The retained transaction, `source-18`, still produces the same discrepancy under the same real process crash. Retained raw input bytes fell from 124,524 to 5,659 (about 95.5% less). Supporting provenance and proof are retained, so this is not the percentage reduction in the entire export's disk size. The original capture and case were preserved.

The discrepancy remains one excess counted trade, 19,082,820 excess lamports (0.019082820 SOL), and 1,351,089,180,462 excess token base units in the same program/mint/side group. These are incorrect totals in a test database; no money moved.

## Acceptance evidence

The machine-readable receipt is [phase-3-validation.json](phase-3-validation.json). Full private captures, run traces and exports remain local. The receipt identifies their hashes and bounded outcomes without publishing the recordings or credentials.

| Case | Same defect on faulty sample | Correct result on fixed sample |
| --- | --- | --- |
| Full: 19 transactions | 5 of 5 attempts | 5 of 5 attempts |
| Reduced: 1 transaction | 5 of 5 attempts | 5 of 5 attempts |

All 20 comparison attempts used fresh state, applied the required crash and verified owned cleanup. Faulty and fixed attempts within each case used identical input and scenario hashes. There were no unresolved or runner-error attempts in this measured comparison.

The failure fingerprint is `e84ddce510bc99a28d373ec2bf05efe7d36c16c9a95d27e55f21b81d1b102c32`. It includes assertion, projection, stable fault, discrepancy group/field and direction. A different crash or setup failure cannot count as reproducing this defect.

Reduction used three fresh faulty runs: the original baseline, the one-transaction candidate and a final recheck. All reproduced the target failure, applied the required fault, verified fresh state and removed owned database state. Search took 30,794 ms within a 20-attempt, 900-second, 512-MiB scheduling budget. The sole retained transaction contains the mandatory crash anchor; the reported claim is **1-minimal under declared transaction units**, not a globally smallest reproducer.

The comparison uses pinned faulty/fixed configurations of the same maintained adapter artifact. It does not check out arbitrary consumer Git revisions. Each attempt records the source revision, implementation/variant/runtime/input/scenario digests, initial state, fault application, actual traces and final evidence. Whole transactions and declared transitive prerequisites remain indivisible during reduction; expectations are recalculated for the retained subset.

## Export and checks

See the [workflow and offline commands](phase-3-workflow.md) for exact prerequisites, exit meanings, budget and cancellation behavior. A correctness test fails on the buggy sample and passes on the fixed sample; a reproduction command succeeds when it finds the specified old bug.

The export was copied outside the repository and run with a minimal environment, without provider credentials or package installation. Adapter outbound access and PostgreSQL networking were disabled; the local Docker socket and cached image remained declared dependencies. All four exits matched: faulty correctness `1`, fixed correctness `0`, faulty reproduction `0`, fixed reproduction `1`. Removing `schema.sql` and changing a locked history receipt each returned setup error `2`. A local scan found no configured provider credential values in the export.

After the comparison and export checks, the surrounding corpus passed again: `pnpm check` completed type checking and all **79 tests**; `pnpm test:regression` passed all **five PostgreSQL integration tests**.

The implementation's [GitHub CI run](https://github.com/hicksonhaziel/Aftershock/actions/runs/36464865150) succeeded. Automated coverage includes stable failure identity, transaction/event boundaries, prerequisite validation, budget exhaustion, cancellation during execution, original-case preservation and manifest/history integrity, alongside earlier capture, duplicate, crash and recovery checks.

## Scope review and limits

The [product-scope review](scope-review.md) maps the original workflow to implemented evidence and remaining limits. The project remains on the capture → expectations → isolated execution → controlled failure → discrepancy → reduced case → offline regression → verified-fix path.

This is an intentional defect in the maintained sample, not a discovered external-project bug. The capture remains bounded, with six explicitly excluded v1 transactions; completeness of the chain or filtered interval is not established. Business expectations share the pinned decoder. The normalized adapter has no executable stream-control messages: original control-frame context remains in the capture manifest, while future adapters needing such inputs must declare them. Local Docker, the cached pinned PostgreSQL image and the declared Node/platform runtime remain required; five repeats measure finite repeatability, not universal determinism. Older exports use their original runtime and need a freshly generated current case for Phase 3 operations.

Phase 4 is the durable API, worker and browser workbench. Phase 5 retains the full external consumer adapter, second sample and broader reliability requirements. Phase 6 retains deployment and submission.
