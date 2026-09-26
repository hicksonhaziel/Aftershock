# Phase 0 acceptance report

**Completed September 27, 2026. Phase 1 is ready to begin.** This closes foundation and interface validation, not the full Aftershock product. No consumer persistence-fault campaign, reducer, portable regression runner or dashboard is claimed complete.

## Exit gates

| Gate | Evidence | Result |
| --- | --- | --- |
| Authentic bounded Solami capture and explicit finalized reference | Two captured intervals matched their finalized filtered blocks; exact responses, capture links and checksums retained locally | Complete for the named intervals |
| Written transport, filter, decoder, event identity and control decisions | `provider-access.md`, `adapter-protocol.md`, external integration plan and scoped Rust decoder replay | Defined, with version exclusions |
| Versioned schemas and incompatible-input rejection | Contracts for capture, envelopes, coverage, scenarios, adapters/protocol, trade events, snapshots, checkpoints, assertions, runs, faults, incidents, reduced cases and exports; positive/negative tests | Passed |
| External consumer revision and integration plan | Pinned MIT indexer, dependency/file hashes, Rust 1.96.1 build, replay bridge, observation-only patch and scoped output evidence | Selection/build input gate passed; full adapter/campaign pending |
| Clean local setup installs, type-checks and starts required services | Fresh temporary source checkout, frozen/offline cached dependency install, whitespace/type checks, all 50 tests, new Compose project/database startup and SQL checks | Passed |

## Observed data evidence

- First full reference: slots 450672624–450672626, 25 recorded transactions all present, 29 filter matches across full blocks. Four additional matches were in the partly recorded final block. Reference ID `d8c3845b-189d-4f61-ae2c-0417bced0acd`.
- Second full reference: slot 450820268, 25 recorded transactions all present, 48 full-block filter matches. The recording stopped at its configured limit. Reference ID `b3a9ed04-b4f2-4e1f-bc17-8639650ee5ef`.
- Two reconnect experiments each reobserved all 25 known boundary transactions among 200 replay deliveries and advanced to later slots. Latest experiment `607252dd-684f-41cc-9be0-85d9910866da`. This is bounded replay evidence, not proof of recovery across arbitrary gaps/outages.
- Two offline compatibility audits matched all 25 messages in their respective recordings across legacy/v0/v1 message fields. The latest audit is `ed52df58-95a2-4f35-bbbc-6c035d9c2aff`. Balances, logs, inner instructions, business decoding and future wire fields are outside that audit's scope.
- External decoder: 23 supported legacy/v0 messages selected from the first recording, two explicitly excluded v1 messages, zero replay skips, 22 emitted event identities. Repeating input produces the same identities again. This was a decoder check without a database, not an idempotency campaign.
- Separately attributed upstream fixture: 503 distinct events, 111 transactions with multiple distinct event identities. This supports path/ordinal identity design; it is not represented as newly captured Solami evidence. The upstream exact-amount test also passed. Details and source hashes are in the integration directory.

## Local state, licensing and access

PostgreSQL runs in its own `aftershock-dev` Compose project on localhost:55439. Schema checks create a fresh run-owned database and verify exact large integers, unique event keys and SQL rollback, then remove only that test database. An existing-volume/missing-password guard was verified. Tests in a clean checkout also started, checked and stopped a separate project; no ordinary project database was used. CI now includes those service checks.

Aftershock's own code uses MIT. The external project's license/attribution remain separate. The project owner reports that another Solami trial can be requested when the current seven-day trial ends and that judges use their own keys. Renewal is manual. No paid service was enabled. Credentials and raw evidence remain excluded from Git.

The root repository has one pnpm lockfile with pinned direct dependencies. The external consumer retains its own upstream Cargo.lock as an independently built application; it is not a second JavaScript workspace. Rust/compiler/source/patch/input identities are recorded in its build-validation report.

## Boundaries carried into Phase 1

The first external decoder supports legacy/v0 Pump.fun CPI trade inputs; v1 is explicitly gated because the pinned Rust converter cannot represent it. Unknown/new event layouts require a versioned decoder change and revalidation. A passing decoder sample is not universal event correctness.

Phase 1 implements isolated consumer execution, the first clean/duplicate assertion, faulty/fixed maintained samples and a portable regression command. Phase 2 adds real process-kill/commit-barrier recovery. External persistence campaigns, reduction, the workbench, broader reliability and deployment remain later acceptance requirements. The protocol schemas define those interfaces now; they do not substitute for their implementations.
