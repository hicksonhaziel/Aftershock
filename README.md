# Aftershock

Turn Solana ingestion bugs into reproducible regression tests.

Aftershock is being built to capture mainnet data through Solami, test isolated consumers under controlled failures, retain evidence, and export regression cases that verify fixes.

## Current status

**Phases 0–3 complete for the declared CLI scope; Phase 4 started.** Aftershock captures and normalizes supported Solana trades, runs isolated PostgreSQL samples, kills and restarts a consumer, reduces the same failure to a smaller case, and exports an offline regression. The flagship was reduced from 19 transactions to one; both cases reproduced the intentional defect five times and passed with the correction five times. See the [Phase 3 report](docs/phase-3-report.md), [reduction workflow](docs/phase-3-workflow.md) and [scope review](docs/scope-review.md). The initial [local API and durable worker](docs/workbench-api.md) now save campaigns, progress and incident evidence. The [Phase 4 progress report](docs/phase-4-progress.md) distinguishes this backend milestone from the pending browser workbench and full external adapter.

## Local setup

Requires Node.js 22.22+ (22.x) and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
pnpm run doctor
pnpm rpc:check
pnpm stream:check
```

Set `SOLAMI_RPC_URL` in the ignored `.env` file to the endpoint issued by your Solami account. Never paste credentials into issues, screenshots, or versioned files. For the stream probe, set `SOLAMI_STREAM_URL` to your issued HTTPS gRPC endpoint and `SOLAMI_STREAM_TOKEN` to its x-token. If no stream token is set, the probe uses `SOLAMI_API_KEY`.

`doctor` checks local configuration without making network requests or printing credential values. It exits with `3` when the RPC configuration is missing, `2` for a setup error, and `0` when the current local checks pass. A successful diagnostic validates URL syntax, not endpoint access. `pnpm rpc:check` makes two read-only requests to verify the mainnet genesis hash and retrieve a finalized slot; it never prints endpoint credentials.

## Workspace

- `packages/contracts`: versioned capture, execution, protocol and regression-artifact contracts.
- `packages/capture`: compressed raw storage, capture sealing, and integrity verification.
- `packages/solami`: bounded read-only RPC requests with sanitized failures.
- `packages/runner`: isolated adapter process lifecycle and protocol enforcement.
- `packages/projection`: expected trade state and concrete event/aggregate discrepancies.
- `packages/reference`: finalized captured-signature membership and coverage reporting.
- `packages/control`: persistent jobs, fenced worker ownership and private evidence storage.
- `apps/api`, `apps/worker`: authenticated local campaign API and durable engine worker.
- `apps/cli`: diagnostics, bounded live capture, and reference commands.
- `docs/architecture.md`: implementation boundaries and unresolved decisions.

## Development checks

`pnpm check` runs strict TypeScript checking and tests covering integer precision, schema compatibility, explicit adapter acknowledgements, and separate coverage/verdict reporting. With the local database running, `pnpm test:regression` checks the offline engine and `pnpm test:control` checks PostgreSQL job ownership and actual API/worker execution. CI runs all three.

Aftershock uses MIT; external source attribution is retained separately. See [local setup and licensing](docs/local-setup.md) and the [adapter protocol](docs/adapter-protocol.md).

## Streaming connectivity probe

`pnpm stream:check` requests confirmed slot updates, closes after three slot messages (at most 20 frames, 256 KiB total, or 20 seconds), and saves received protobuf bytes plus checksums under the ignored `.aftershock/probes/` directory. This checks access and framing only; it is not a transaction capture, replay test, or completeness guarantee. Partial artifacts from interrupted/failed probes are not sealed captures.

## Capture transactions

```sh
pnpm capture config/capture.example.json
pnpm capture:verify .aftershock/captures/<capture-id>
```

The example requests successful, non-vote transactions whose account list mentions the Pump.fun program, at confirmed commitment. It checks static and loaded account addresses locally too. Mentioning a program is not a claim that every transaction is a swap or that the program was invoked.

Default limits are 25 transactions, 100 frames, 2 MiB raw data, and 10 seconds after subscription opens. The first limit reached stops capture. Each received frame is saved before decoding as an independent gzip-compressed protobuf chunk. A sealed manifest contains the filter, timestamps, slots, signatures, per-frame hashes, totals, stop reason, and SDK wire-schema version. A separate file hashes the manifest. Endpoint URLs and tokens are not included.

The integrity command verifies the manifest and decompresses/checks every recorded frame. It does not establish finalized-chain completeness. The collector performs a separate mainnet RPC genesis check before connecting; it does not independently prove the streaming endpoint's cluster. Bounded full-filter reference reconstruction, captured-signature membership, and reconnect experiments are available below.

A duration-limited nonempty capture is a valid bounded observation, not a complete slot interval. Byte limits explicitly record a discarded boundary frame. Stream/decode/filter failures preserve prior evidence with a non-success stop reason; hard termination or storage failure may leave an unsealed directory. No automatic reconnect is attempted yet.

Capture returns `0` for a nonempty capture stopped by a configured limit, `2` for setup/storage/stream/decoding/filter failure, and `3` for an empty capture, cancellation, or an unexpected stream end. Integrity verification has its own result and must not be confused with consumer correctness.

## Check captured transactions against finalized blocks

```sh
pnpm reference:check .aftershock/captures/<capture-id>
```

This command verifies capture integrity, checks the RPC mainnet genesis and finalized tip, enumerates the capture's slot interval with `getBlocks`, and retrieves each returned block's signatures with finalized `getBlock`. It compares each recorded signature with the block at its recorded slot. Duplicate deliveries are counted without creating a false missing-transaction result.

`PASS` means the recorded signatures were found in finalized blocks. It does **not** prove that the capture contains all matching transactions, that the program was invoked, that trade decoding is correct, or that any consumer is correct. Both streaming and reference evidence come from Solami; this is a different retrieval method, not independent provider trust. A transaction-capped capture can begin or end partway through a block.

Unavailable, null, malformed, or unfinalized required evidence stays unresolved and prevents a pass. An absent signature in a successfully retrieved block is reported as a discrepancy, not automatically attributed to a provider defect. Slot numbers not returned by `getBlocks` are recorded explicitly; an unreturned slot containing a captured observation remains inconclusive.

The first implementation accepts at most 16 slots, attempts each reference request at most twice, stops scheduling reference requests after 60 seconds, and has a 120-second process safety timeout. Each RPC response is capped at 2 MiB and retained successful responses at 16 MiB. Genesis/tip setup requests are made once. Error bodies and credentials are not retained.

Evidence is saved under `.aftershock/references/<reference-id>/`: exact successful RPC response bodies with SHA-256 hashes, the request ledger, per-slot coverage, per-signature results, and the parent capture ID/manifest hash. `reference.json` has its own checksum. The original capture is never modified. A hard timeout can leave unsealed evidence.

Exit codes: `0` membership passed, `1` an observed signature is absent from available finalized block evidence, `2` setup/storage failure, and `3` inconclusive evidence. Business-event projection remains future work.

## Reconstruct the full matching set

```sh
pnpm reference:check .aftershock/captures/<capture-id> --full-filter
```

This mode reads full finalized JSON blocks and applies the capture predicate: successful, non-simple-vote transactions mentioning any configured account. It resolves v0 lookup addresses and supports legacy, v0, and v1. Unknown versions or incomplete metadata prevent complete coverage. It does not decode trades or business events.

The mode accepts at most four slots, caps each response at 16 MiB and total retained responses at 64 MiB, and keeps the same time/retry bounds. The report includes the complete matching set for available blocks and transactions not observed in the capture. These differences do not establish provider loss: the recording can start or stop inside a block. `PASS` still describes captured membership only.

Live validation on September 26, 2026 reconstructed 29 matching transactions across three blocks; all 25 captured transactions matched. Four additional matches were in the final boundary block. The responses contained legacy, v0, and v1 transactions. Report, response hashes, and capture provenance were verified. An earlier request limited to version 0 correctly remained inconclusive on RPC error -32015.

Format semantics follow [Solana versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions); simple-vote classification follows the [Solana SDK checker](https://github.com/anza-xyz/solana-sdk/blob/master/transaction/src/simple_vote_transaction_checker.rs). Both capture and reference still rely on Solami. More intervals and checks beyond the message fields audited below remain necessary before broader coverage claims.

## Audit streaming message compatibility offline

```sh
pnpm compatibility:check .aftershock/captures/<capture-id> .aftershock/references/<reference-id>
```

Supply the capture and its `--full-filter` reference. This makes no network requests. It verifies capture integrity, reference/response checksums and the parent link, then compares each recorded transaction with its finalized RPC representation. The comparison covers signatures, inferred message version, header, static and loaded account addresses, blockhash, top-level instructions, lookup references, version 1 configuration, and success status.

Reports under `.aftershock/compatibility/<audit-id>/` carry hashes linking both source artifacts. Exit codes are `0` all recorded transactions match, `1` a field mismatch, `2` invalid setup/integrity, and `3` missing or unsupported evidence. An empty capture cannot pass. Unsafe numeric reference values cannot establish exact integer equality.

The first offline audit passed all 25 recorded transactions: five legacy, eighteen v0 and two v1. The installed Yellowstone SDK already preserves version 1 configuration, including integer priority fees as decimal strings. This does not certify balances, logs, inner instructions, business-event decoding, future protocol fields, or capture completeness. Tests cover lost v1 configuration, altered instruction/address fields, missing evidence and checksum tampering.

## Observe reconnect and replay

```sh
pnpm reconnect:check
```

This experiment runs the existing capture command in two separate processes. It records up to 25 transactions, waits for the first process to close, pauses for 1.5 seconds, and starts a new subscription with `fromSlot` set to the last slot observed in the first capture. The second recording is capped at 200 transactions, 500 frames, 4 MiB raw data, or 10 seconds. Each child has a 70-second timeout followed by a three-second termination grace period.

It verifies both capture seals and writes a checksummed report linking their manifests. The report lists known transactions received again, those not re-observed within the bounded run, and whether later-slot transactions arrived. Exit `0` requires healthy sessions, at least one known replayed transaction, all known boundary transactions re-observed, and a later-slot observation. Incomplete observations return `3`; setup or evidence failures return `2`.

This deliberately closes a capture process and creates a new subscription; it does not simulate a validator outage or prove gap-free delivery. An unseen transaction in this bounded experiment is not automatically a provider defect. Provider replay is labelled separately from live-only capture. Evidence stays in the ignored `.aftershock/reconnect/` directory.

For a plain-language explanation of what is built and what comes next, read [Understanding Aftershock](docs/understanding-aftershock.md).

## Selected external consumer

The first external target is [shaurya35/solana-realtime-indexer](https://github.com/shaurya35/solana-realtime-indexer), pinned to `fdcb07381ec5c2a971f3107a7f9ec53542c1fb60` under MIT. The [integration plan](integrations/solana-realtime-indexer/README.md) records source findings, hashes, attribution, Pump.fun trade identity/projection, duplicate-replay assertions and required process controls. Selection, pinned build and scoped decoder replay are validated. The full adapter and a conclusive external persistence campaign remain outstanding.

## Local test database and external replay input

```sh
pnpm db:up
pnpm db:check
pnpm capture:export-replay .aftershock/captures/<capture-id> --legacy-v0-only
```

The database helper targets only an Aftershock Compose project; see [local setup](docs/local-setup.md). The replay bridge preserves embedded protobuf bytes and records every explicit v1 exclusion for the pinned external consumer. It does not execute a consumer campaign or create a portable regression case. See the [validated integration scope](integrations/solana-realtime-indexer/README.md).
