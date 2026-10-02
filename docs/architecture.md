# Initial architecture decisions

Status: Phases 0–4 accepted for the declared maintained-sample CLI/workbench scope. Version 1 interfaces are implemented by the isolated runner and maintained PostgreSQL samples, with failure-preserving reduction and pinned repeated comparisons. See [Phase 3 acceptance](phase-3-report.md), [reduction workflow](phase-3-workflow.md) and [scope review](scope-review.md).

## Established boundaries

- Node.js 22 with a pnpm TypeScript workspace and one lockfile.
- Shared application schemas are strict and versioned. They do not describe Solami wire framing.
- Slots, offsets, and sequence counters are unsigned decimal strings to avoid precision loss.
- Delivery identity and business-event identity are distinct. A transaction signature is not a universal business-event key.
- Adapter acknowledgements explicitly distinguish receipt, processing, and durable commit.
- Assertions carry their checking lane and evidence coverage separately from their verdict.
- The supervisor owns process termination. An in-process exception or graceful stop is not a crash test.
- Capture files and local credentials are ignored. Credentials must never enter exported metadata.

## Next implementation gates

1. Complete the external persistence adapter, second maintained sample and broader reliability checks in Phase 5; preserve explicit v1 exclusions until supported.
2. Verify deployment and submission in Phase 6.

The [Phase 4 acceptance](phase-4-report.md) records the completed durable browser workflow and its limits.

The implemented CLI path uses immutable captured frames, pinned decoder observation, declared expected state, separate clean/duplicate runs in owned network-disabled PostgreSQL containers, concrete discrepancies and bundled offline regression commands. The maintained fixed sample only adds newly inserted event effects to totals and commits its checkpoint atomically. The supervisor observes real post-commit process kills and restarts against retained state; explicit overlap tests both builds. Reference, clean/faulted and application result lanes remain distinct. See the workflow guide for runtime/dependency limits.

The web layer uses Fastify, a persistent PostgreSQL worker and a React/Vite evidence workbench for capture, scenarios, incidents, reduction, comparison and exports. Control jobs live separately from disposable sample state. Expired saved-input jobs restart into a new attempt directory and fresh databases; expired live captures remain inconclusive without resubscription. Ownership fences reject stale progress and publication. Immutable saved inputs and actual engine traces remain the source of verdicts. Public hosted execution will run maintained examples; private consumer execution belongs on the developer's local runner. Local pairing requires same-origin loopback intent; hosted-sample pairing requires an operator token and HTTPS origin. Both paths execute only the trusted maintained sample. Cases pin runtime/source hashes, supporting finalized references and explicit exclusions. Storage admission and monitoring are application limits, not a hard disk quota. See the [API and setup guide](workbench-api.md) for authentication, recovery and operation budgets.

## Provider documentation discrepancy

On 26 September 2026, Solami's public documentation/index exposed descriptions and trial terms that differ from the bounty text. Treat neither as proof of account entitlement. Validate the issued account directly before relying on a transport, schema, or plan limit.

References: https://solami.dev/docs and https://solami.dev/llms.txt. Authenticated RPC requests on 26 September 2026 verified the full mainnet genesis hash and returned a finalized slot. A bounded Yellowstone subscription also received three confirmed slot updates through the standard API key.

## Streaming authentication research

The current client-rendered Solami docs specify `https://grpc.solami.dev` and `x-token` metadata. Standard API keys are accepted for gRPC; account entitlement must still be tested. Mirage requires a saved subscription and an API key with `MirageStream`, and sends binary protobuf `SubscribeUpdate` messages. The probe requests only slots and stops after three slot observations, 20 frames, 256 KiB, or a 20-second timeout. Raw protobuf frames are written before decoding and referenced by SHA-256 in local probe evidence. This is a connectivity test, not a transaction capture or completeness claim.

The dedicated gRPC x-token was subsequently verified with the same three-slot probe and is now the configured credential. Both probes closed successfully; stored frame hashes were verified for the dedicated-token run.

## Bounded transaction capture

The initial writer stores one protobuf frame per independent gzip chunk and fsyncs it before decoding. This keeps the first implementation bounded and preserves wire bytes; multi-frame batching and compression optimization are deferred until measured. Captures have an immutable application-level seal (exclusive writes and append rejection), not filesystem write protection. Hashes detect corruption, not malicious replacement of both data and checksums.

Capture metadata records successful/non-vote account-mention semantics, commitment, arrival order, monotonic offsets, slot and signature, resource limits, and termination reason. Loaded writable/read-only addresses participate in the local predicate check. Business-event extraction is a separate pinned decoder/normalization step; it does not modify raw captures. Missing metadata, invalid protobuf, and filter mismatches stop the capture explicitly.

The mainnet check is performed on the configured RPC endpoint before the stream opens. It is separate evidence from the stream. The stream has no genesis response in this workflow. Capture manifests deliberately leave reference coverage unassessed; separate reference and reconnect reports carry their own evidence.

## Finalized signature membership

The first reference lane retrieves block signature lists, not decoded full transactions. It verifies that recorded `(slot, signature)` observations are present after finalization and keeps this assertion separate from filtered capture completeness. An interval with complete reference retrieval does not imply that a transaction-limited stream capture is complete.

Successful RPC bytes and their hashes are retained under a new reference ID linked to the immutable capture manifest. Enumeration failure is never converted into an empty block range; null blocks, invalid responses, and unfinalized intervals stay unresolved. Both transport and reference use Solami, so the evidence is not independent provider verification.

The 26 September live check found all 25 recorded transactions in finalized blocks across slots 450672624–450672626. It made six successful RPC requests and retained 88,009 response bytes. Response hashes, the report hash, and the parent capture link were verified locally. This first check alone did not complete Phase 0. Subsequent full-filter, replay, external decoder and setup evidence is recorded in the Phase 0 report.

Protocol references: [getBlocks](https://solana.com/docs/rpc/http/getblocks), [getBlock](https://solana.com/docs/rpc/http/getblock).

## Reconnect experiment evidence

On 26 September, the experiment recorded 25 live transactions, closed that capture process, and requested replay from the last observed slot in a new process. All 25 known boundary transactions were received again among 200 replay-session deliveries, and later-slot data arrived. The baseline contained 145,389 raw bytes and the second capture 1,177,419 raw bytes. Both captures and the report links passed integrity verification.

This is a single observed provider replay case. It does not prove complete recovery, transaction uniqueness across all provider traffic, or consumer idempotency. Each individual capture still records zero internal reconnects; the experiment report links the separate processes and their requested replay boundary.

## Streaming message compatibility scope

The installed Yellowstone 7.0.1 schema includes the optional message `config` used by v1. Version is inferred from config presence, then the versioned flag; it is not a universal future-version detector. We compare that inference with explicit RPC transaction versions. Raw protobuf remains preserved even for fields the decoder does not expose.

`compatibility:check` audits saved, linked evidence without network access. The first run matched five legacy, eighteen v0 and two v1 transactions on message fields, loaded accounts and success status. Unknown or incomplete evidence stays inconclusive; malformed or tampered source artifacts fail setup. The comparison excludes business events, balance arithmetic, logs and inner instructions. This validates the current message input path for these observations, not the future application's projection.

Schema source: [Yellowstone storage protobuf](https://github.com/rpcpool/yellowstone-grpc/blob/master/yellowstone-grpc-proto/proto/solana-storage.proto). The selected consumer and scoped event/output contract are documented in [the integration plan](../integrations/solana-realtime-indexer/README.md). Its build and scoped replay bridge are now validated; version 1 protocol definitions are in `adapter-protocol.md`, and process control is implemented for the Phase 1 maintained samples.
