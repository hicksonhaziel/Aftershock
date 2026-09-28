# Maintained trade-ledger sample

This sample intentionally provides two modes, `faulty` and `fixed`, for Aftershock's duplicate and crash/recovery demonstrations. It consumes recorded normalized Pump.fun trades over the adapter protocol and persists them in an owned disposable PostgreSQL container.

`faulty` inserts events with a unique business key but adds their values to totals for every delivery. `fixed` uses `INSERT ... RETURNING` so only newly inserted rows contribute to totals. The faulty build now saves its checkpoint separately after the observed commit barrier. The fixed build commits accepted effects and checkpoint atomically. Both wait at `afterDurableEffectCommit`; the supervisor can release them or perform a real process kill, restart and explicit overlap. See the [recovery guide](../../docs/phase-2-workflow.md).

This is Aftershock-owned demonstration code. Its intentional defect must not be attributed to the external indexer. Use the [workflow guide](../../docs/phase-1-workflow.md) to run a campaign and inspect evidence; do not point it at an ordinary database.
