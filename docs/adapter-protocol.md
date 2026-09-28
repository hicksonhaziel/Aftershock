# Adapter protocol 1 and artifact contracts

The process supervisor, maintained sample lifecycle and post-commit crash/recovery runner now implement these interfaces. Reduction remains later work. Executable schemas are in `packages/contracts/src/execution.ts`, with accepted and rejected examples in its tests. Capture/reference schemas remain separate from consumer execution.

## Initial data contract

Transport is Yellowstone `SubscribeUpdate` from Solami. Capture stores exact wire bytes before decoding, confirmed/finalized observation level, account-mention predicate and parent hashes. RPC finalized reconstruction establishes the matching transaction set for a bounded interval; it does not turn a partial recording into complete chain coverage.

The first business projection is `pumpfun-trades-v1`: successful Pump.fun CPI `TradeEvent` instructions, decoded using the external consumer's pinned Carbon decoder. Its build/replay evidence is recorded in the external integration directory. Unsupported decoder layouts/transaction conversions receive explicit exclusions; they cannot become zero-event successes. Business event identity includes chain, program, signature, instruction path, ordinal and projection version. Two trades inside the same transaction retain different paths/ordinals. Delivery identity is separate and changes on replay.

Trade amounts are canonical decimal strings in integer lamports and mint base units. Compare event rows and group totals by program/mint/side. Do not sum unrelated token units, infer program invocation from account mention, or treat USD pricing as part of this contract. Receipt timestamps are excluded from semantic state equality.

## Process transport and lifecycle

Use one child process per consumer run, JSON-RPC 2.0 over newline-delimited UTF-8 stdin/stdout. Each line is at most 1 MiB; stdout is protocol-only, stderr is diagnostic output with credentials redacted. Requests have unique string IDs and `params.protocolVersion: 1`. Process one mutating request at a time; unexpected/duplicate response IDs, malformed output or timeouts become `RUNNER_ERROR`. No unrestricted shell commands are accepted from an artifact.

| Method | Required state | Result/meaning |
| --- | --- | --- |
| `describe` | Any nonterminated state | Declared projection, ack semantics, boundaries and uncontrolled dependencies |
| `start` | New/reset | Bind one run and its owned initial state; return `started` |
| `resume` | New process on retained owned state | Bind the run and continue runner delivery sequence; actual checkpoint remains separately observed |
| `deliver` | Started/drained | Feed bounded referenced input; return receipt/processed/durable ack exactly as declared; invalidate drained state |
| `drain` | Started | Stop accepting deliveries; wait for all work through requested sequence and successful writer flush |
| `snapshot`, `checkpoint` | Drained | Committed state and explicit watermark/support status; never a queue position passed off as durability |
| `releaseBarrier` | Paused at that barrier | Release the named barrier for the same run; a stale/unknown barrier is an error |
| `stop` | Started/drained/paused | Graceful stop; not a crash; a stopped process accepts no new delivery |
| `reset` | Stopped | Verify run ownership token, reset only its disposable state, return `reset` |

The supervisor enforces lifecycle ordering, sequence monotonicity, artifact hash verification, response-ID correlation and commit-barrier correlation. Schemas validate message shape and local cross-field consistency, not an entire execution history. Inputs and artifact paths are relative, hash-linked references; path traversal and credential-bearing URLs are rejected. Exports may request recorded dependencies only. The runner resolves paths inside its owned directory, rejects symlink escapes, isolates process networking and bounds execution/output. It runs trusted code, not arbitrary hostile adapters.

Drain success requires zero pending work, skips, write errors and dead letters; otherwise return an explicit error/inconclusive result. Successful processing of one non-trade transaction can emit no events, but required nonempty campaign evidence cannot pass vacuously. An empty or partly unsupported decoder corpus is not an accepted baseline.

## Shared crash boundary

Both maintained faulty/fixed samples expose `afterDurableEffectCommit` immediately after a successful business-effect SQL commit, before accepting another input. Emit a `barrier` notification identifying the run, barrier, event identities, covered input boundary and actual checkpoint, then wait. The supervisor records the notification and kills the process externally (not an exception or graceful stop).

The intentionally faulty sample may commit its checkpoint separately after this barrier. The fixed sample atomically commits deduplicated business effects and checkpoint before this same logical barrier. Record that difference; do not require a checkpoint-only hook absent from the fixed build. The fixed build must also handle explicit duplicate delivery even when its checkpoint already advanced.

A checkpoint is not proof of all effects. The assertion compares the declared state projection after restart/replay. Required but unsupported/untriggered faults prevent a PASS. Keep planned fault IDs separate from observed application evidence. A barrier identifies exact committed batch/event identities, rather than an unreliable wall-clock delay.

## Artifact boundaries

`coverage` records interval, missing slots and explicit exclusions. `scenario` pins input, initial state, order, faults and limits. `assertion` pins checking lane, implementation, expected projection and required faults. `snapshot` pins drained boundary, state and same-run checkpoint. `run` pins scenario, consumer revision, adapter, runtime, fault outcomes, assertions and evidence. `incident` records the failed assertion and failure identity. `reducedCase` retains that identity, stable anchors and reproduction runs. `exportManifest` retains consumer/adapter/runtime locks, initial state, assertions, recorded dependencies and distinct reproduction/regression commands.

All artifacts have schema version 1 and reject extra fields. Verdict and coverage are separate: incomplete whole-chain coverage does not automatically invalidate an offline metamorphic assertion. A PASS still requires its named assertion and every required fault to have succeeded. Exports/reduction schemas establish required provenance; implementing and verifying portable replay and failure-preserving reduction belongs to later phases.

See [the Phase 2 workflow](phase-2-workflow.md) for actual supported recovery policies, result lanes and limits.
