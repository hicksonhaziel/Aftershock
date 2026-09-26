# Aftershock agent instructions

## Product and current work

Aftershock turns Solana ingestion bugs into reproducible regression tests. Preserve the complete workflow: live capture → declared expectations → isolated consumer execution → controlled failures → inspectable discrepancies → reduced case → offline regression → verified fix.

The project is in Phase 0: foundations and technical validation. RPC access, bounded Yellowstone slot streaming, an initial filtered transaction capture, finalized captured-signature membership checks, and one bounded reconnect/replay experiment have worked against Solami. Bounded full-filter finalized reference reconstruction also passed one three-slot live check, including legacy/v0/v1 transactions. An offline message-field compatibility audit also matched 25 recorded transactions against full RPC evidence, exercising legacy/v0/v1. Broader reference/reconnect validation, business-event decoding, consumer adapters, fault execution, reduction, and the workbench remain open. The external consumer is selected and pinned in `integrations/solana-realtime-indexer/`; its build, adapter and campaign are not yet validated. Consult current code and evidence before reporting capabilities.

The local blueprint and build phases document guide implementation when present. They are private planning files and are not distributed with this repository. Keep public setup and architecture documentation self-contained.

## Commit and push after small completed changes

The user explicitly authorizes automatic commits and pushes to this repository. Do not ask again for routine commits or pushes within the requested work.

- Work in small, coherent increments. After each completed fix, feature increment, refactor, configuration change, documentation change, or test addition/update, run the relevant checks, commit that increment, and push it before starting another independent increment.
- Do not accumulate an entire phase or several unrelated changes before pushing. Separate useful steps such as a contract, storage implementation, CLI integration, and documentation when each can stand on its own.
- Keep each pushed commit buildable and its relevant checks passing. Include a fix and the test that proves it in the same commit when appropriate.
- Running tests without changing tracked files does not require an empty commit. Report the results instead.
- Stage explicit paths. Inspect the staged diff and filename list before every commit. Do not use blanket staging that may include unrelated user work or private artifacts.
- Use concise commit messages describing the concrete change. Push the current authorized branch to `origin`; set its upstream on the first push when needed.
- Before the first push in a session, verify the configured remote and inspect remote refs. The expected repository is `hicksonhaziel/Aftershock` on GitHub.
- Never force-push, rewrite published commits, bypass a rejected push, or overwrite remote work. Investigate divergence and preserve both sides.
- If a check or push fails, fix the cause where possible. State the remaining failure clearly; do not report work as pushed unless the push succeeded.
- Do not commit unrelated pre-existing user edits. Account for them before staging.
- In progress/final updates, distinguish implementation, verification, local commits, and successful pushes.

## Files that must never be committed or pushed

This restriction overrides the automatic commit rule:

- `Aftershock_Project_Blueprint.md`
- `BUILD_PHASES.md`
- `.env` and any file containing real credentials, authenticated endpoint URLs, tokens, or secrets
- `.aftershock/`, including local captures, probes, and private runtime artifacts
- Dependency installations, generated build output, and temporary diagnostic downloads

Keep the two planning files in Git's local exclude list and the repository ignore rules. Never use `git add -f` to bypass these exclusions. A placeholder-only `.env.example` is permitted. If a protected file is unexpectedly tracked, stop it from entering a new commit and investigate without deleting the user's local copy. Do not rewrite remote history without explicit authorization.

The user authorizes reading and editing local `.env` for development. Do not print its contents or expose credentials in logs, errors, test fixtures, screenshots, manifests, commits, or chat. Use sanitized error messages. Credentials remain server-side.

## Implementation rules

- Use the TypeScript/pnpm workspace and a single lockfile. Pin direct dependencies and verify compatibility with the repository's Node version.
- Keep shared schemas in `packages/contracts`, raw storage in `packages/capture`, and command orchestration in `apps/cli`. Introduce new packages with working functionality rather than empty scaffolding.
- Preserve raw provider messages before decoding. Carry capture IDs, hashes, source bounds, signatures, and coverage through later artifacts.
- Distinguish delivery identity, transaction identity, and business-event identity. A signature does not uniquely identify every event inside a transaction.
- Represent large chain integers as decimal strings and amounts as integer base units. Keep unrelated mints and units separate.
- State filter semantics precisely. Mentioning an account does not establish program invocation or a decoded swap.
- Bound capture time, bytes, frames, execution time, storage, and reduction attempts. Keep incomplete and failed evidence inspectable.
- Keep provider framing and application contracts separate. Validate actual Solami behavior before relying on advertised capabilities.
- Keep live data, synthetic fixtures, intentional defects, injected failures, and replay clearly labelled.
- Do not imply chain completeness from a successful connection, slot jump, checksum, or clean/faulted comparison.
- Use accurate verdicts: `PASS`, `FAIL`, `INCONCLUSIVE`, `UNSUPPORTED`, `RUNNER_ERROR`, and `CANCELLED`. Coverage and reproduction confidence remain separate.
- Consumer tests use disposable state. The supervisor owns real process termination; an exception is not a process-crash test.
- Record configured and actually applied faults separately. Missing hooks or untriggered required faults cannot establish a verified fix.
- Reduction must preserve the original failure identity, dependencies, and stable fault anchors. Reproduction and regression-testing commands have different success meanings.
- Declare uncontrolled dependencies and measure repeated outcomes. Do not claim universal determinism.

## Verification and evidence

- Run type checking and meaningful tests appropriate to each change. Add regression coverage for substantive bugs; avoid tests that only repeat implementation details.
- `pnpm check` runs the repository's current automated checks. Use targeted checks during small changes and the full suite when shared behavior changes.
- Live commands (`rpc:check`, `stream:check`, and `capture`) contact Solami and consume account resources. Keep them bounded and run only when needed to validate provider behavior.
- Verify saved capture integrity separately from semantic correctness and finalized-chain coverage.
- Do not activate paid plans, enable pay-as-you-go, change billing settings, or publish external claims without authorization.
- Record actual results and limitations in appropriate documentation. Update local phase progress only when backed by evidence; never push that planning file.
- Do not mark a whole phase complete just because one component works.

## Collaboration

- Explain progress in plain language: what works, what was tested, what remains, and the next concrete step.
- Preserve the full product scope while completing dependencies in order.
- Do not launch sub-agents unless the user explicitly requests delegation or parallel agent work.
- Do not contact maintainers or other people without explicit authorization.
