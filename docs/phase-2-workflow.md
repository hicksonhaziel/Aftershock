# Crash, restart and recovery checks

Phase 2 adds an actual post-commit process kill to the maintained trade sample. These are intentional sample defects and controlled delivery failures, not provider incidents or bugs attributed to the external indexer.

## Run the complete supported matrix

Use the same setup and normalization procedure as [Phase 1](phase-1-workflow.md), then:

```sh
pnpm build:regression
pnpm campaign:recovery .aftershock/normalized/<id> .aftershock/references/<id>
```

The reference argument is optional. When provided, it must be a sealed `reference:check --full-filter` result for the same parent capture. The runner verifies recorded response hashes and reconstructs the membership result offline, using the original account-mention filter. Legacy/v0/v1 reference handling, bounded block enumeration and retries are reused from the reference engine. An unavailable block remains unresolved. A slot-number jump never establishes loss. Unsupported trade-decoder v1 messages remain explicit normalization exclusions.

The command first runs faulty clean, faulty crash/replay, fixed clean and fixed crash/replay, exporting the confirmed crash case only when the correction passes. It then tests the fixed sample with disconnect/overlap, temporary omission followed by recovery, and permanent omission. Recovery acceptance means the declared outcomes were observed; the permanent omission run itself remains `INCONCLUSIVE`.

For just the flagship comparison:

```sh
pnpm campaign .aftershock/normalized/<id> phase2 crash .aftershock/references/<id>
```

The original duplicate campaign remains available without the `crash` argument. Exported crash cases use the same `node regression.mjs test|reproduce <case-directory> faulty|fixed` commands and distinct exit meanings documented in Phase 1.

## What the crash proves

Each attempt starts with a new owned, network-disabled PostgreSQL container. The adapter and supervisor both verify empty tables, and the report records the empty-state digest. One input can contain multiple business events; they retain separate identities and commit together in the sample's SQL batch.

Both builds emit `afterDurableEffectCommit` after the event/totals transaction commits and wait for a correlated release. At the selected stable event anchor, the supervisor sends `SIGKILL` to the consumer process group and observes its exit. It then reads persisted event IDs and checkpoint directly from the still-running database before launching a new consumer process.

The faulty sample has committed its event rows and unconditional total increments, but has not saved its separate checkpoint. The fixed sample has atomically saved accepted-event effects and its checkpoint. Both receive the same explicit one-input overlap, including when the fixed checkpoint already advanced. The fixed sample only increments totals for newly accepted events.

`resume.throughSequence` continues the runner's delivery sequence; it is not a fabricated durable checkpoint. Actual database checkpoint evidence is retained independently. Restart does not reset state. Reset happens after the final drained inspection and is verified before cleanup.

## Evidence and checking lanes

- Application: expected versus actual event identities, fields, unique rows and per-program/mint/side integer totals. The run's verdict belongs to this named saved-input assertion.
- Metamorphic: compare the clean sample's observed event state with its faulted run, separately for faulty and fixed builds. This does not independently validate their shared decoder.
- Reference: re-evaluate captured transaction membership from saved full finalized block responses. It does not claim capture completeness or independent business-event decoding. A missing optional reference is explicitly inconclusive and does not erase a conclusive saved-input application result.

The flagship campaign writes `checking-lanes.json` and `reference-lane.json`. Each run retains delivery and recovery traces, commit notifications, actual termination signal, pre-restart checkpoint, replay anchor, final snapshot, discrepancies, configured/applied faults, reset verification and cleanup outcome. Hash-linked run/incident files point to that evidence. Provider references remain separate from the portable saved-input regression assertion.

## Supported boundaries and limits

One crash at the first occurrence of a stable event anchor, one reconnect with a one-input overlap, or one omitted input are supported per scenario. Mixed non-duplicate fault combinations and later crash occurrences are explicitly unsupported. Temporary omission moves the input to the end; permanent omission withholds it and prevents a conclusive recovery result. The current sample's checkpoint/batch checks cover all events in one input committed in a single SQL transaction. Arbitrary mid-statement kills and checkpoint-ahead-of-write mutations are not implemented.

The inherited limits remain: at most 1,000 input transactions/10,000 events, at most 10,000 deliveries, a configured consumer execution window of at most 300 seconds across restarts (120 seconds for generated cases), 15-second requests, bounded combined process output, and bounded database setup/cleanup. Database setup occurs before the consumer execution window. Linux user/network namespaces, the exact exported Node version/architecture, a local Docker daemon and the cached digest-pinned PostgreSQL image are required. No image pulls or provider requests occur during recovery execution.

The process namespace blocks IP networking; the local Docker Unix socket is an explicitly trusted dependency. These are trusted adapters, not a hostile-code filesystem sandbox. PostgreSQL is not killed by the consumer crash. This tests consumer process failure, not database power loss. Measured executions do not establish universal determinism. Repeated reduction/fix stability belongs to Phase 3.

## External state controls

```sh
pnpm external:state-check .aftershock/normalized/<id> /absolute/path/to/pinned-upstream
```

The selected external binary and migrations must match the checked-in hashes. The command runs ordinary finite Rust replay twice in separate processes against the same fresh owned database, with IP networking disabled and only a local PostgreSQL Unix socket exposed. It checks replay/skip counts, inspects durable events/trades/checkpoints and dead letters, compares full stored event/trade state across restart/overlap, and verifies an owned reset. Exact trade amounts are strings; stored event payload JSON is retained as text to avoid losing large integers in JavaScript.

`state-adapter.ts` implements ownership-checked inspection, reset and explicit recovery metadata. External precise commit barriers are still declared unsupported. This advances the integration; it does not replace the full external adapter and acceptance work in Phase 5. No upstream business-logic mutation is added for these controls.
