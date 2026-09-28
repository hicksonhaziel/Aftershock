# Phase 2 acceptance — September 28, 2026

Phase 2 is complete for the supported CLI recovery scope. Aftershock now observes a durable commit, kills the maintained consumer process with `SIGKILL`, checks the database left behind, restarts the consumer and explicitly replays overlap. The faulty sample fails its totals assertion; the corrected sample passes with the same required crash actually applied.

Implementation: `459b9029d1ca95c5ed2b5bc41e8350331a915dec`. [GitHub CI run 36452047264](https://github.com/hicksonhaziel/Aftershock/actions/runs/36452047264) passed, including all 76 unit/protocol/integrity checks and four PostgreSQL/integration tests. See [commands and boundaries](phase-2-workflow.md) and the [machine-readable receipt](phase-2-validation.json).

## Authentic saved-input acceptance

This phase replayed the September 27 capture; it did not present a new live capture or send a Solana transaction. Parent capture `b65159a0-3812-408a-9a6a-eae1e9cd373d` covers slots 451132920–451132921. The pinned ordinary decoder supplied 19 legacy/v0 trade events; six v1 transaction messages remain explicitly excluded.

The committed-build flagship campaign is `5728d792-c8e3-4057-9bf7-cf0bba8a688e`, seeded with `phase2`. Both clean runs passed. The faulty crash run failed; the fixed crash run passed. Both faulted runs have an observed post-commit `SIGKILL`, successful restart and actual replay of `source-18`.

At the selected commit, the runner delivery sequence was 11. The faulty durable checkpoint was still 10; the fixed checkpoint was already 11. After restart, both builds received the selected input again. Both finished with 19 unique trade rows from 20 deliveries. The faulty sample's affected sell group had:

| Field | Expected | Actual | Excess |
| --- | --- | --- | --- |
| Trade count | 1 | 2 | 1 |
| SOL lamports | 19,082,820 | 38,165,640 | 19,082,820 |
| Mint base units | 1,351,089,180,462 | 2,702,178,360,924 | 1,351,089,180,462 |

The SOL excess was **0.019082820 SOL**. The token amount belongs only to that mint; unrelated token units are not combined. The corrected sample had no discrepancies. Every attempt verified fresh initial state, reset after inspection and removed its owned database container.

This is an intentional Aftershock sample defect. It is not a claimed Solami incident or an external-indexer bug.

## Recovery and separate checking lanes

Recovery matrix `ffef47d7-acf5-42c4-ae08-06aabc003f1c` completed with the declared outcomes: fixed reconnect/one-input-overlap `PASS`, temporary omission/recovery `PASS`, permanent omission `INCONCLUSIVE`. Configured faults were actually applied. Permanent withholding retains the missing-event discrepancies without misreporting a consumer bug or successful complete recovery.

The reference lane independently re-executed the filter/membership checks against saved, checksummed full-block responses from reference `84147a00-a3dc-45c0-ab4e-a9123e7771b9`. All 25 captured transactions were present. The full blocks contain 39 filter matches, with 14 not observed in the bounded recording. This is not evidence of provider loss or full capture completeness. Both sources are Solami, and this reference does not independently decode business events.

The clean/faulted comparison lane reported faulty `FAIL` and fixed `PASS`. Application results remain separate from that comparison and from finalized membership. Tests verify that unavailable reference blocks remain unresolved, corrupt evidence becomes a runner error, and absent/untriggered crash hooks cannot count as passing faults.

## Offline and external checks

The crash case was exported, copied outside the repository and executed without provider environment variables or IP networking. Regression testing failed on the faulty build and passed on the fixed build; reproduction succeeded only for the faulty build's recorded failure. The receipt records all four exit meanings. The export was checked against local credential values without exposing them. Captures, exports and run artifacts remain local.

External state-control check `716aa248-fa21-4da1-979d-a654db170270` passed with the pinned Rust binary and upstream migrations. Two separate finite replay processes shared one fresh disposable database. The second replay delivered the same supported inputs; stored events and trades remained unchanged. Checkpoint/dead-letter inspection and owned reset succeeded. Event payload JSON is retained as text and trade amounts as decimal strings to preserve integer precision.

The external check advances reset, inspection and restart/overlap support. Precise external commit barriers remain explicitly unsupported; the general external process adapter and full Phase 5 acceptance remain open. No new upstream business-logic mutation was introduced.

## Scope still open

Supported crash/batch behavior is one post-commit kill at a first-occurrence stable event anchor, including multiple events in one input transaction. Arbitrary mid-statement kills, checkpoint-ahead-of-write mutations, mixed recovery faults and later anchor occurrences are not supported. PostgreSQL remains running during the consumer crash; database power-loss durability is not tested.

Offline exports require Linux, the recorded Node version and architecture, the local Docker daemon and the cached digest-pinned PostgreSQL image. Execution is bounded and IP-network isolated, but trusted adapters are not a hostile-code filesystem sandbox. These measured outcomes do not establish universal determinism. Dependency-aware reduction and the five-attempt full/reduced fix comparisons belong to Phase 3; the web workbench, broader integration and deployment are later phases.
