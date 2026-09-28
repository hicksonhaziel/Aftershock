# Understanding Aftershock

Aftershock will help developers find bugs in apps that read Solana transactions.

A Solana trade can happen once while an app receives its saved message twice. That app should still count the trade once. Aftershock repeats messages or stops the app after a database save, then checks its trade records and totals.

## Phase 0 is finished

Phase 0 means preparing and checking the foundations. It does not mean the full app is finished.

We can now receive real Solana data through Solami, save the original messages, check the recording against finalized blockchain records, and ask Solami to replay earlier messages. Two bounded capture/reference checks passed, and two reconnect tests recovered all 25 known boundary messages in each test.

We also have a separate local test database, rules for how future test tools communicate, and automated checks for the data formats. A clean setup passed all 50 tests and the database checks.

## The external app

We built a pinned version of `solana-realtime-indexer`, an existing app that reads trade messages. It read 23 supported messages from our recording and found 22 events. It cannot safely read the newer version 1 format, so the bridge explicitly excluded two messages and kept a record of that choice. Aftershock's recorder itself still preserves those messages.

Another saved fixture showed multiple trade events inside a single transaction. This is why our event IDs include where the event happened inside the transaction, not just the transaction's name.

The external app now also passed a saved-trade restart check: it stored the supported trades, restarted, received them again, and kept the same stored trades. Its precise crash hook and full adapter are still later work.

## Phase 1 is finished

We recorded fresh Solana transactions and read 19 supported token trades. Six other transaction messages used a format our chosen decoder cannot handle, so we clearly excluded them.

We sent those 19 trades to two sample apps. Both got the right answer when each message arrived once. Then we repeated one transaction:

- The deliberately buggy app kept 19 trade records but counted an extra 0.010564641 SOL in its totals.
- The corrected app kept both the records and totals right.

We saved that example as a test, copied it outside the project, and ran it without Solami keys or internet access. The buggy app failed the test; the corrected app passed.

These were saved messages sent to test apps. We did not buy tokens, spend SOL or send new transactions on Solana.

## Phase 2 is finished

We now actually stop the sample app after it saves a trade. Then we restart it and send that saved trade again.

The buggy sample forgets where it stopped and counts the trade value twice. The fixed sample remembers its progress and handles the repeated message correctly. Both apps really receive the crash; the fixed app does not skip the test.

We also checked reconnecting, recovering a missing message, and a message that never arrives. If it never arrives, Aftershock says there is not enough evidence to confirm recovery.

## What comes next

Later phases shrink failing examples, build the visual dashboard, finish external-app campaigns and prepare the public demo.

Solami worked in our live checks. When the trial expires, you can request another one; the judges will use their own keys. Our offline development can continue using the saved recordings.

The technical evidence and remaining limits are in the [Phase 0 report](phase-0-report.md), [Phase 1 report](phase-1-report.md) and [Phase 2 report](phase-2-report.md). Your private planning files, credentials and raw recordings stay out of GitHub.
