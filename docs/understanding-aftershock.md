# Understanding Aftershock

Aftershock will help developers find bugs in apps that read Solana transactions.

Imagine a shop receives the same order twice because its connection dropped. The shop should still count one order. Aftershock will deliberately repeat messages or stop an app at a controlled moment, then check whether its records are still right.

## Phase 0 is finished

Phase 0 means preparing and checking the foundations. It does not mean the full app is finished.

We can now receive real Solana data through Solami, save the original messages, check the recording against finalized blockchain records, and ask Solami to replay earlier messages. Two bounded capture/reference checks passed, and two reconnect tests recovered all 25 known boundary messages in each test.

We also have a separate local test database, rules for how future test tools communicate, and automated checks for the data formats. A clean setup passed all 50 tests and the database checks.

## The external app

We built a pinned version of `solana-realtime-indexer`, an existing app that reads trade messages. It read 23 supported messages from our recording and found 22 events. It cannot safely read the newer version 1 format, so the bridge explicitly excluded two messages and kept a record of that choice. Aftershock's recorder itself still preserves those messages.

Another saved fixture showed multiple trade events inside a single transaction. This is why our event IDs include where the event happened inside the transaction, not just the transaction's name.

Reading events successfully does not yet prove the app stores them correctly after duplicates or crashes. Those are the tests we build next.

## What comes next

Phase 1 connects the pieces: saved data → sample app → repeated message → incorrect total → saved regression test → corrected app passing.

Later phases add real crash/restart tests, reduce failures into smaller examples, build the visual dashboard, finish external-app campaigns and prepare the public demo.

Solami worked in our live checks. When the trial expires, you can request another one; the judges will use their own keys. Our offline development can continue using the saved recordings.

The technical evidence and remaining limits are in the [Phase 0 report](phase-0-report.md). Your private planning files, credentials and raw recordings stay out of GitHub.
