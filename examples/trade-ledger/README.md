# Maintained trade-ledger sample

This sample intentionally provides two modes, `faulty` and `fixed`, for Aftershock's duplicate-delivery demonstration. It consumes recorded normalized Pump.fun trades over the adapter protocol and persists them in an owned disposable PostgreSQL container.

`faulty` inserts events with a unique business key but adds their values to totals for every delivery. `fixed` uses `INSERT ... RETURNING` so only newly inserted rows contribute to totals. Both commit effects and their delivery checkpoint in one SQL transaction in Phase 1. Neither implements the later crash barrier.

This is Aftershock-owned demonstration code. Its intentional defect must not be attributed to the external indexer. Use the [workflow guide](../../docs/phase-1-workflow.md) to run a campaign and inspect evidence; do not point it at an ordinary database.
