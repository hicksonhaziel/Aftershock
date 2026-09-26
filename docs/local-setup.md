# Local setup and isolated consumer state

Use Node 22.22.2, pnpm 10.33.0, and Docker Engine with Compose v2. Run `pnpm install --frozen-lockfile`, then `pnpm check`. Copy `.env.example` to `.env` only when live provider access is needed. Offline tests and database checks do not require Solami keys.

```sh
pnpm db:up
pnpm db:check
pnpm db:down
```

`db:up` starts the digest-pinned PostgreSQL 15 image in the fixed `aftershock-dev` Compose project, binds only localhost port 55439, and creates a random password in ignored `.aftershock/dev-db.env` (mode 0600). It never connects to an environment-provided database URL. Keep that local password file while reusing the development volume. `db:down` stops this Compose project and preserves its volume.

`db:check` creates a uniquely named database, applies `migrations/001_consumer_state.sql`, records a run ownership token, and checks exact integers above JavaScript's safe range, business-key uniqueness and transaction rollback. It drops only that newly generated database after verifying ownership. If interrupted, the leftover database retains its generated name/ownership marker for inspection. Never use broad DROP/TRUNCATE commands against unrelated databases.

The schema defines ownership, immutable business event identities, per-program/mint/side integer totals, and durable consumer checkpoints. It provides disposable state for the maintained samples. The external indexer uses its own pinned migrations in a separate owned database. Database schema tests do not establish that a consumer implements idempotency or atomic checkpoints; those are Phase 1/2 execution tests.

The future supervisor must allocate one database per run, hold its ownership token, restrict the consumer to that database, and verify ownership before reset/removal. The bootstrap user is a local development owner, not a public-service security boundary. Remote arbitrary-code execution is outside this setup. Existing containers/databases for other projects are not managed by these commands.

## License and attribution

Aftershock uses MIT to permit reuse of local adapters and exported test tooling with attribution. The repository license covers Aftershock's own code. The pinned external indexer's MIT notice is retained separately in `integrations/solana-realtime-indexer/LICENSE.upstream`; do not replace its copyright with ours. Preserve third-party notices when distributing copied source or binaries. Dependency/license review for a distributable bundle remains a release task; no upstream endorsement is implied.
