# Trade projection: first Phase 1 batch

`packages/projection` calculates expected state from already decoded trade events and compares it with an observed consumer state. It is a library foundation for the coming runner, not an executable consumer campaign or a business-event decoder.

The `pumpfun-trades-v1` contract supports the declared Pump.fun program only. Identity includes chain, program, transaction signature, absolute instruction path, event ordinal and projection version. Repeated observations with the same identity contribute once; conflicting business fields in expected observations are rejected. Multiple events within one transaction remain distinct. The caller must supply validated decoder output and retain its source capture/hash links.

Totals keep program, mint and buy/sell direction separate. SOL is measured in lamports and tokens in that mint's integer base units. All counts and amounts are decimal strings, calculated with integer arithmetic. This scope has no independent pool field: it models Pump.fun bonding-curve trades by mint, not arbitrary pools or USD volume.

`expectedTradeState(events)` derives an empty-initial-state expectation. `compareTradeState(events, observedState)` checks event presence, uniqueness, slot, mint, trader, direction, amounts, aggregate presence/uniqueness, counts and totals. Aggregate mismatches retain expected, actual and signed difference. A consumer must supply its stored aggregates: replacing them with recalculated totals would conceal duplicated side effects. Row order and provenance location do not affect semantic equality; provenance remains retained on rows and must be integrity-checked by the future runner.

Nonempty matching evidence returns `PASS`; concrete discrepancies return `FAIL`. Empty expected evidence returns `INCONCLUSIVE`, retaining any discrepancies. Invalid or out-of-scope evidence returns `RUNNER_ERROR` from this library boundary; capability negotiation must reject unsupported projections before a campaign. Each state is limited to 10,000 events and 10,000 aggregate groups.

These are application assertion results only. They do not establish finality, decoder correctness, quiescence, applied faults, durable storage or complete chain coverage. The future supervisor must gate campaign verdicts on those separate requirements.

Seven synthetic tests cover multiple-event identity, repeated observations, large integer precision, separate mint/direction totals, unique rows with inflated totals, row/aggregate discrepancies, semantic ordering/provenance independence, empty inputs and invalid evidence. Run them with `pnpm exec tsx --test packages/projection/test/projection.test.ts`; `pnpm check` includes them with the repository suite.

Next: connect supported authentic event decoding, then implement isolated process execution and maintained faulty/fixed samples. The fresh-capture → duplicate failure → portable offline regression → fixed pass acceptance gate remains open. Real process-crash recovery belongs to Phase 2.
