# Product-scope review

Reviewed during Phase 3 implementation, September 28, 2026. The project remains focused on turning Solana ingestion failures into reproducible tests. This is a scope and evidence review of the implemented pipeline, supported by code inspection and regression checks; it is not a claim that every possible defect has been ruled out.

| Product step | Implemented evidence | Important limit |
| --- | --- | --- |
| Record authentic Solana data | Checksummed original Yellowstone frames, capture IDs and declared filters; Phase 0/1 reports | Bounded captures are not complete-chain recordings |
| Establish expectations | Successful supported Pump.fun trades, full event identity, exact integer amounts and per-program/mint/side totals | The business expectation shares the pinned decoder; account mention is not program invocation; no generic pool inference |
| Check source evidence | Finalized block enumeration, filter reconstruction, membership and explicit missing evidence | Same provider through different retrieval methods; not independent provider trust |
| Execute controlled failures | Disposable owned PostgreSQL, correlated commit barriers, actual consumer SIGKILL, restart and explicit overlap | PostgreSQL remains running; no database power-loss claim |
| Explain what went wrong | Unique event rows alongside exact excess totals, durable checkpoints and configured/applied-fault traces | The demonstrated counting defect is intentional sample code |
| Make a smaller test | Whole-transaction removal, declared prerequisites, stable anchors, rebuilt subset expectations and unchanged failure identity | Only declared removable units; no globally smallest-case claim |
| Test the correction repeatedly | Locked standalone runner, fresh state for each faulty/fixed attempt, retained outcomes and hashes | Finite measured repeatability; not universal determinism |
| Export the test | Offline runtime, input/assertion/source locks, proof/history and separate reproduce/test commands | Exact runtime and cached local Docker/PostgreSQL prerequisites remain |

## Gaps corrected during this review

The earlier failure identity recorded affected fields but did not include the assertion, stable fault or excess/deficit direction. Phase 3 strengthens it so a different failure cannot be accepted just because the command failed.

Repeated comparisons now invoke the exact standalone runner inside the case, rather than applying the current orchestration code to a differently pinned case. Each receipt records the consumer variant/build, environment lock, inputs, initial state and observed evidence.

Exports now validate the manifest checksum and its links to the runtime lock, including reduction and attempt-history evidence. Cancellation and insufficient reduction budgets preserve the original case and retain qualified outcomes. Tests cover these behaviors alongside the existing duplicate, crash, recovery and offline checks.

The saved mainnet capture used for acceptance was checked again: all 26 stored frames, 25 transaction observations and the original manifest checksum remain intact. That integrity check is kept separate from consumer correctness and chain completeness.

## What remains later work

The full product is not finished. Phase 4 is the browser workbench, API and durable worker. Phase 5 includes the full external process adapter and its remaining acceptance requirements, a second maintained sample and sustained reliability measurements. Phase 6 is deployment, live hosted acceptance and submission.

The external Rust integration has ordinary decoder replay and a bounded persistence/restart/reset check. Its precise crash hook remains unsupported. We have not substituted our intentionally faulty sample for a claim about the external application's correctness.

No optional AI feature, trading execution, broad protocol expansion or unrelated website work was added. The capture-to-test path remains the priority. Private planning files, provider credentials and local recordings remain outside the repository.
