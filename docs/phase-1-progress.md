# Phase 1 progress

Phase 1 is in progress. The fresh-capture → clean baseline → duplicate failure → portable regression → fixed pass gate has not been completed.

## Implemented foundations

- Expected Pump.fun trade state and concrete event/aggregate discrepancies (`packages/projection`).
- Capture-to-trade normalization using the pinned external consumer's ordinary Carbon decoder, with a separate observation patch that emits exact integer fields.
- A process supervisor (`packages/runner`) for trusted adapters using JSON-RPC over standard input/output. It enforces response correlation, lifecycle, contiguous delivery sequences, delivery identity uniqueness, declared acknowledgement semantics, successful drain, snapshot/checkpoint boundaries, reference hashes, request/run time limits and output limits.

The supervisor runs each adapter in a new Linux user/network namespace with a minimal environment. Network isolation is mandatory: unsupported hosts fail instead of silently falling back. Tests prove a host loopback listener is unreachable and a synthetic credential is not inherited. This is not a filesystem sandbox for hostile executables, a memory/CPU quota, or a database provisioner. Only trusted executable paths/arguments supplied by application code may be used. Input artifacts cannot choose a command. Caller-owned directories and lifecycle ownership tokens must be fresh per run; database reset ownership must also be enforced by the eventual adapter.

Protocol tests use an explicitly synthetic adapter, not a maintained consumer or a persistence campaign. The supervisor currently rejects unsolicited notifications, including crash barriers. Process termination on timeout/disposal is cleanup, not evidence of an injected crash at a durable commit boundary.

## Normalize a saved capture

Requires Linux with `/usr/bin/unshare`, enabled unprivileged user/network namespaces, and the exact verified decoder build named in `integrations/solana-realtime-indexer/trade-decoder-lock.json`.

```sh
pnpm capture:normalize .aftershock/captures/<capture-id> /absolute/path/to/solana-realtime-indexer --legacy-v0-only
```

Without the optional flag, v1 causes explicit failure. With the flag, every excluded v1 transaction is retained in the normalization report. The selected legacy/v0 corpus is the declared scope; this does not certify the full capture. Duplicate transaction signatures in the selected capture are currently rejected because the observation bridge cannot unambiguously associate repeated signatures with source deliveries.

The command verifies capture integrity and the decoder binary hash, extracts original transaction-info bytes, and executes a finite single replay with a 60-second timeout and 16 MiB output bound. It passes no database/provider environment, uses a temporary working directory outside project ancestors, refuses existing dotenv files in temporary-directory/root ancestors, and disables network access. It requires explicit zero-skip completion and matching observed event counts. Unknown source identities, slot mismatches, malformed values, duplicate event IDs and empty decoded event sets fail.

The ignored output directory contains original uncompressed source frames, normalized events, expected state and a checksummed report. Events carry raw-source hashes; the report records the parent capture ID/manifest hash, source sequence/slot/signature mapping, decoder/patch identities and exclusions. This is an intermediate artifact, not the finished portable regression export. Capture/reference completeness remains unassessed here, and expected values share the external decoder; this is not independent validation of its business semantics.

## Observed saved-capture result

On September 27, 2026, the saved Phase 0 capture `991da3d0-526d-4c74-b00b-3b6f4921c818` produced 22 supported trade events from 23 legacy/v0 transactions, with two explicit v1 exclusions. The patched binary rebuilt with Rust 1.96.1 in 8.78 seconds using the existing cache. This used already saved authentic mainnet inputs with no live provider requests and no database enabled. It does not establish consumer persistence/idempotency.

For another platform/build, the binary digest may differ. Rebuild the pinned source with both observation patches and the pinned compiler/lockfile, revalidate it and deliberately update the decoder lock before execution; the normalizer never accepts an arbitrary binary silently.

## Next work

Implement maintained faulty/fixed trade consumers with disposable durable state, connect normalization and supervisor to a campaign command, record configured/applied duplicate faults and delivery traces, and gate baseline/faulted results separately. Then export and run the same case offline against both builds. A fresh capture is required for the Phase 1 acceptance gate. Real durable-commit crash/recovery remains Phase 2.
