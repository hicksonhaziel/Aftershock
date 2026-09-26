# External consumer selection

Selected on September 26, 2026: [shaurya35/solana-realtime-indexer](https://github.com/shaurya35/solana-realtime-indexer), revision [`fdcb07381ec5c2a971f3107a7f9ec53542c1fb60`](https://github.com/shaurya35/solana-realtime-indexer/tree/fdcb07381ec5c2a971f3107a7f9ec53542c1fb60).

**Status: source reviewed and revision pinned; not built, adapted, or campaign-tested yet.** This selection does not complete Phase 0 or the external-integration acceptance requirement. No upstream defect or maintainer endorsement is claimed.

`upstream.json` records the exact commit and SHA-256 hashes of reviewed files, including the upstream dependency lockfile. Downloaded research sources remain local and ignored. Updates require deliberate re-review and a new pin; do not follow `main` during a campaign.

## Why this consumer

This Rust application consumes Pump.fun/PumpSwap transactions and persists events and trades in PostgreSQL. Its existing finite protobuf replay source lets Aftershock test the real decoder, processor and writer without replacing their business logic. A different implementation language also exercises the planned process interface instead of depending on TypeScript imports.

Compared with [Jayant818/sol-indexer at 1ea67fd](https://github.com/Jayant818/sol-indexer/tree/1ea67fd7ac0dc069ffcc73d30f6313c4c2d71e22), this selection has a more directly usable saved-message entry point: that candidate's `file_source.rs` currently generates synthetic signatures and empty gRPC payloads. A standalone parser such as [Tee-py/solana-txn-parser](https://github.com/Tee-py/solana-txn-parser) would not by itself test durable state or restart behavior.

## Source findings

All paths below refer to the pinned upstream revision, not an implemented Aftershock adapter.

| Source | Finding and adapter consequence |
| --- | --- |
| `src/datasources/replay.rs` | Reads JSONL with numeric `slot` and base64 `data` containing `SubscribeUpdateTransactionInfo`, not the full stream envelope. Replays a finite number of passes when `repeat > 0`; malformed/unsupported records can be skipped. Count and expose all skips. |
| `src/main.rs`, `src/cli.rs` | `replay --path <file> --repeat 1` optionally uses `DATABASE_URL`; omit `--resolve` to avoid the RPC pool resolver. Replay without a database is not a persistence test. |
| `src/processors/pumpfun.rs` | Produces rows only for successful decoded CPI `TradeEvent` instructions. Mentioning Pump.fun in account keys is insufficient. Uses decoded integer SOL/token amounts and event path identity. |
| `src/identity.rs`, migrations | Identity is `(signature, absolute_path, event_ordinal)`. A signature alone is insufficient. Keep multiple trade events from the same transaction. |
| `src/writer.rs` | `send` enqueues work; it is not durable acknowledgement. Writer batches up to 100 entries or flushes on a 500 ms timer. `write_batch` puts events, trades and checkpoint in one SQL transaction. |
| `src/db.rs` | Event/trade inserts use `ON CONFLICT DO NOTHING`. This motivates a duplicate-idempotency campaign but is not proof of correctness. |
| `src/pipeline.rs` | Normal completion drops the pipeline and awaits its writer task, but ignores the task's join result. Process exit alone cannot prove successful persistence; inspect state, errors and dead letters. |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Carbon 1.0 decoder dependencies, Yellowstone protobuf 10.1.1, edition 2024, upstream `stable` toolchain. Pin an exact working compiler/image during build validation. TypeScript SDK compatibility does not prove this Rust converter handles v1. |

The MIT license is retained in `LICENSE.upstream`, including Shaurya Jha's copyright. Preserve it with upstream source or substantial copied portions, and retain dependency notices when distributing builds. Source review has not audited all transitive dependency licenses. Aftershock's own repository license remains a separate open decision.

## Initial input and projection

The initial external campaign targets successful Pump.fun CPI trade events, not all account mentions, PumpSwap pool resolution, token transfers or USD valuations. Preserve raw Solami frames and parent hashes. Produce a separate derived JSONL artifact containing the embedded transaction-info protobuf bytes plus slot, with a mapping back to capture delivery sequence, slot, signature and raw hash. Never overwrite the capture or silently drop unsupported messages.

Before execution, validate the pinned Rust conversion/decoder on representative legacy, v0 and v1 inputs. A failing version receives an explicit exclusion/unsupported result; it must not be labelled an empty successful transaction. The existing 25-transaction recording includes all three versions but has not yet been decoded by this consumer. At least one authentic trade event and one multi-event transaction must be confirmed before accepting a campaign baseline.

Canonical event identity in the Aftershock projection will include chain, program, signature, instruction path, ordinal and projection version; the upstream row key maps to its signature/path/ordinal components. Keep delivery identity separate so replayed deliveries can refer to the same business event.

Inspect durable `events` and `trades` ordered by their full keys. Compare exact integer base units as decimal strings. Derive counts and sums from stored trades grouped by program, token mint and side; SOL amounts remain lamports, token amounts remain their own mint's base units. Do not mix mints or call these sums USD volume. Exclude wall-clock receipt timestamps from semantic equality. Compare checkpoint progress separately: a slot/signature watermark does not identify every input or prove every event was stored.

## First supported campaign to implement

1. Create a new disposable PostgreSQL database owned by the test run; apply all pinned migrations. Never use a developer's ordinary database or upstream's generic truncate helper.
2. Establish a nonempty decoded baseline from finalized, supported authentic inputs. Record expected event identities, relevant fields and explicit exclusions. A baseline with skips, write errors, dead letters or missing required evidence cannot pass.
3. Replay the same finite input twice against a separate fresh database with the unmodified decoder/processor/write logic. Use the same input order, dependency records and initial state.
4. Drain all processing and writer work, inspect the durable database, then compare complete event/trade rows and per-mint counts/sums with the once-delivered baseline. This is a metamorphic idempotency assertion, not independent decoder validation or provider-completeness evidence.
5. Later, add a supervisor-controlled process kill at a measured `afterDurableEffectCommit` barrier, restart, replay overlap and inspect the same projection. Until the barrier is implemented and observed, crash-after-commit is unsupported rather than passed.

Use finite replay (`--repeat 1` or `2`); upstream `--repeat 0` loops indefinitely. Bound file size, deliveries, run duration and database ownership. Execute with a minimal environment, a working directory without the project's `.env`, and networking restricted to the disposable database. Do not pass Solami credentials or enable live recovery/resolution during offline execution.

## Required adapter controls

Planned adapter operations are `describe`, `start`, `deliver`, `drain`, `snapshot`, `checkpoint`, `stop` and run-owned `reset`. Requests have IDs, a protocol version and bounded payloads. Logs must be separate from machine responses. Finite CLI replay can bootstrap the duplicate case; it does not provide per-message acknowledgements or crash barriers on its own.

- `deliver` acknowledgement initially means receipt only. Never promote queue acceptance or decoder completion to durable commit.
- `drain` must wait for decoder/processor completion and writer flush, surface join/write failures and skip/dead-letter counts, and report the covered delivery boundary. Zero emitted events can be valid for an individual supported non-trade input, but an empty required campaign is inconclusive.
- `snapshot` reads committed state only after a successful drain; it carries the projection version, run ID and covered delivery boundary.
- A durable barrier is emitted only after successful SQL commit, with an ID and the committed batch's event/input identities. The worker then waits for supervisor release or actual process termination. Its presence must not change transaction contents or uniqueness behavior.
- The supervisor owns fresh state, real process termination, restart and cleanup. A returned error or graceful shutdown is not a crash injection.
- Preserve the ordinary decoder/processor/database logic. Record any wrapper, instrumentation or configuration patch separately with its hash, changed files/line count and integration effort. An intentionally mutated build must be labelled as such.

## Remaining integration gates

Build with the pinned lockfile and a recorded compiler; verify the replay bridge and Rust version support; confirm trade/event identity on authentic input; implement isolated database lifecycle and observations; run the clean/duplicate campaign; add and validate the real commit barrier. Record actual results and limitations. Selection and source verification alone are not a completed external integration.
