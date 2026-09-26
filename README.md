# Aftershock

Turn Solana ingestion bugs into reproducible regression tests.

Aftershock is being built to capture mainnet data through Solami, test isolated consumers under controlled failures, retain evidence, and export regression cases that verify fixes.

## Current status

Early implementation: TypeScript workspace, draft contracts, RPC verification, a live slot-stream probe, bounded filtered transaction capture, offline capture integrity verification, and finalized signature-membership checks. Fault execution, reduction, and the workbench are not implemented yet. Unit tests use synthetic inputs; live captures are kept separately in ignored local storage.

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

- `packages/contracts`: draft versioned envelopes, adapter descriptions, and check results.
- `packages/capture`: compressed raw storage, capture sealing, and integrity verification.
- `packages/solami`: bounded read-only RPC requests with sanitized failures.
- `packages/reference`: finalized captured-signature membership and coverage reporting.
- `apps/cli`: diagnostics, bounded live capture, and reference commands.
- `docs/architecture.md`: implementation boundaries and unresolved decisions.

## Development checks

`pnpm check` runs strict TypeScript checking and tests covering integer precision, schema compatibility, explicit adapter acknowledgements, and separate coverage/verdict reporting. CI runs the same checks.

The project license and third-party integration selection are pending. No third-party consumer code has been incorporated.

## Streaming connectivity probe

`pnpm stream:check` requests confirmed slot updates, closes after three slot messages (at most 20 frames, 256 KiB total, or 20 seconds), and saves received protobuf bytes plus checksums under the ignored `.aftershock/probes/` directory. This checks access and framing only; it is not a transaction capture, replay test, or completeness guarantee. Partial artifacts from interrupted/failed probes are not sealed captures.

## Capture transactions

```sh
pnpm capture config/capture.example.json
pnpm capture:verify .aftershock/captures/<capture-id>
```

The example requests successful, non-vote transactions whose account list mentions the Pump.fun program, at confirmed commitment. It checks static and loaded account addresses locally too. Mentioning a program is not a claim that every transaction is a swap or that the program was invoked.

Default limits are 25 transactions, 100 frames, 2 MiB raw data, and 10 seconds after subscription opens. The first limit reached stops capture. Each received frame is saved before decoding as an independent gzip-compressed protobuf chunk. A sealed manifest contains the filter, timestamps, slots, signatures, per-frame hashes, totals, stop reason, and SDK wire-schema version. A separate file hashes the manifest. Endpoint URLs and tokens are not included.

The integrity command verifies the manifest and decompresses/checks every recorded frame. It does not establish finalized-chain completeness. The collector performs a separate mainnet RPC genesis check before connecting; it does not independently prove the streaming endpoint's cluster. Full filtered reference reconstruction and reconnect/replay testing remain pending; captured-signature membership checks are available below.

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

Exit codes: `0` membership passed, `1` an observed signature is absent from available finalized block evidence, `2` setup/storage failure, and `3` inconclusive evidence. Full finalized transaction projection and equivalent-filter reconstruction remain future work.
