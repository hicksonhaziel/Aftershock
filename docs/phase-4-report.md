# Phase 4 acceptance: durable evidence workbench

Accepted 2 October 2026 for the maintained trade sample and the implemented local/hosted-sample paths. The browser now drives the actual engine through fresh recording, finalized reference, normalization, campaign, incident inspection, reduction, repeated comparison and a downloaded offline regression. This completes Phase 4's declared workbench scope. Full external consumer execution and sustained reliability remain Phase 5; public deployment remains Phase 6.

## What works

Fastify serves the React/Vite interface and authenticated API. Persistent PostgreSQL stores projects, recordings, immutable case registrations, jobs and cursor-based progress separately from disposable consumer databases. Transactional claims, renewable leases and generation fences reject stale progress and result publication. An expired saved-input attempt recovers into a new directory and fresh state; an expired live recording stays inconclusive without silently subscribing again. Cancellation retains evidence and prevents derived-case publication.

The interface includes project overview, adapter capabilities, bounded live capture and freshness, recording/reference/normalization stages, seeded supported scenarios, a scenario-by-consumer matrix, incident discrepancies, actual commit/checkpoint/crash traces, original raw-source inspection, reduction dependencies and history, finite faulty/fixed comparison, checksummed download and searchable case library. Saved run/case URLs and progress survive page refresh. Status words and symbols distinguish correctness, unsupported inputs, unresolved evidence, setup errors and cancellation.

Local pairing requires explicit same-origin loopback intent. Hosted sample mode requires an operator token and exact HTTPS origin, with Secure HttpOnly cookies. Browser requests contain IDs and bounded settings, never executable paths or private code uploads. The Runner screen establishes the local execution path by opening the local workbench. Both modes execute only the trusted maintained adapter today. Hosted mode is implemented and authentication-tested; no public deployment was performed.

## Fresh browser acceptance

A new confirmed Solami recording ran from **15:01:00.459 to 15:01:03.834 UTC**. It stopped at the requested 25-transaction limit before its five-second ceiling, retaining **26 frames and 206,554 raw bytes** across slots **452644527–452644528**. Capture `79fb0390-b8c5-4a92-a920-ec69769c740f` and manifest SHA-256 `1e4748870542ac26fc27f2c799cf948893255b8726384c001abc701a3e676a4e` remain linked through every derived case and export.

The first finalized-reference job returned **INCONCLUSIVE**, with no sealed reference. Its underlying cause was not established. A separate bounded diagnostic and a browser retry passed; the failed attempt remains saved. The successful full-filter reference found all **25 captured signatures**, zero absent/unresolved observations, and **32 matching transactions** in the reconstructed blocks. Seven matches were not observed in this bounded recording, at its boundaries. This establishes captured membership, **not capture completeness or provider loss**. Both retrieval methods use Solami.

Normalization retained **16 transaction inputs / 16 business events** and explicitly excluded **nine v1 transactions** unsupported by the pinned decoder bridge. The reference report and successful RPC response files were included in the immutable case before execution. Campaigns replay saved inputs; recording them moments earlier does not turn replay into live consumer execution.

The clean baseline passed. The supervisor then actually killed the intentional faulty sample with **SIGKILL** after the durable effect commit at stable input `source-1`. Restart replayed the input while the checkpoint lagged. There were still **16 unique event rows**, but one program/mint/side aggregate counted the contribution twice:

| Field | Expected | Observed | Excess |
| --- | ---: | ---: | ---: |
| Trade contributions in affected group | 3 | 4 | 1 |
| Token base units in affected group | 3,719,757,923,166 | 3,723,891,405,081 | 4,133,481,915 |

The anchor's recorded SOL amount was zero, so this fresh case has no SOL-total discrepancy. This is an intentional maintained sample defect, not a finding against the unmodified external indexer.

Reduction preserved fingerprint `7a94ba5e4966329b24f47ee9269f1e72ad0b04978ab1c6c4736887298933a72a`, the original case, supporting evidence and stable crash anchor. It reduced **16 inputs to one**, and **154,553 to 18,887 raw input bytes**, in three measured attempts under a ten-attempt budget. Its claim is 1-minimal under declared transaction units; it is not a globally smallest reproducer.

The reduced case reproduced the same failure **5/5** times on the pinned faulty variant and passed **5/5** times on the fixed variant. Every attempt used fresh owned state, applied the required crash and verified cleanup. The fixed sample commits effects and its checkpoint atomically and applies aggregate changes only for newly inserted events. These are finite measured outcomes, not universal determinism or arbitrary Git-revision comparison.

The browser downloaded a **2,512,204-byte** archive with SHA-256 `bb30cd1d50cd00c4f65c2d4f6bb32d80639db87a5b54bd0701397c4af04ffcb8`. Extraction outside the repository verified the locked case, capture/reference provenance, reduction and attempt history. With only PATH/LANG supplied, the exact bundled runtime produced:

| Command | Exit | Meaning |
| --- | ---: | --- |
| `node regression.mjs test . faulty` | 1 | Correctness assertion failed |
| `node regression.mjs test . fixed` | 0 | Correctness assertion passed |
| `node regression.mjs reproduce . faulty` | 0 | Recorded failure reproduced |
| `node regression.mjs reproduce . fixed` | 1 | Recorded failure absent |

No provider configuration was supplied to those commands. The consumer and disposable PostgreSQL containers were network-disabled; the declared local Docker dependency and cached pinned image remain required. Missing/tampered dependencies are covered by the regression integration suite.

## Verification

`pnpm check` passed type checking, formatting and **81 tests**. `pnpm test:control` passed **nine** PostgreSQL/API/actual-worker integrations, including complete durable operations, protected local/hosted pairing, concurrent admission/claims, stale publication, live expiry, cancellation, lease loss, fresh-state recovery and owned cleanup. `pnpm test:regression` passed **five** offline/PostgreSQL integrations. The production workbench build passed. Final interface/source-label corrections received another typecheck/build and targeted operations integration run.

Browser checks used the built interface, a separate API process, separate worker and real database state. Reload during an active campaign restored its durable ID and deduplicated progress; cursor/SSE reconnection is also verified by HTTP integration. Raw-source inspection showed original bytes/base64, verified hash, full signature, instruction path and exact amounts. Download checksum and relocated execution passed. Requested desktop/mobile viewports were 1280×900 and 390×844; the browser's existing zoom produced approximately 1067 and 325 CSS-pixel widths. Document content stayed horizontally contained; narrow evidence tables scroll inside their own containers. Mobile controls were enlarged and comparison panels stacked. Keyboard route activation, native form focus order and skip-to-content behavior passed. Rendered leaf text in the incident evidence was also checked for at least 4.5:1 contrast after correcting secondary labels. No browser console errors were observed. This is focused accessibility verification, not a formal accessibility audit.

A local API process stopped during the final download check. Restarting it required pairing again because sessions are in memory, while projects, jobs and results remained intact. The repeated browser download then passed. Session persistence across API restart is not claimed. The operator synthetic sample setup command was separately verified without provider calls.

The [sanitized validation receipt](phase-4-validation.json) records actual IDs, hashes, results and attempts. Builds record their pre-commit base revision and actual implementation/runtime digests; a base Git revision alone does not identify uncommitted source contents. Full recordings, credentials, private planning, screenshots and detailed local receipts remain local.

## Limits and next phase

The [workbench setup/API guide](workbench-api.md) documents resource limits and public setup without private planning files. Application storage admission and periodic monitoring are not a hard filesystem quota; hosted operation requires a dedicated bounded durable volume. Retention, backups, public access management, hostile-code isolation, overnight stability and deployment persistence remain operational/release work. The current Docker host is trusted.

The next implementation phase completes the pinned external consumer adapter and a conclusive external campaign, adds the transfer ledger sample, and measures broader scenarios and sustained operation. Deployment and submission follow after that evidence. This acceptance does not claim those phases are complete.
