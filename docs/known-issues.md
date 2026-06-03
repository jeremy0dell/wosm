# Known Issues

These are accepted limitations and testing gaps for the current dogfood milestone.

## Product Limitations

- Real E2E remains opt-in because it requires local Worktrunk, tmux, real harness CLIs, credentials or model access, and isolated temporary projects.
- wosm is still a private workspace package. There is no public npm package, installer, or release artifact outside this repository.
- The scripted/fake-provider release smoke is deterministic, but it does not prove a real harness model response or real Worktrunk shell integration.
- The TUI does not include a row-level inspect/debug panel in v1. Use `wosm doctor`, `wosm snapshot --json`, and `wosm debug bundle` for support evidence.
- Real provider status can be conservative. Provider hooks can promote correlated live rows to working, needs attention, or idle when supported, but terminal-only rows may remain unknown until a reliable hook or provider status signal arrives.
- Worktrunk hook installation is explicit and reversible; it is not applied by `pnpm smoke:release`.
- Cleanup and remove workflows should be tested only against disposable projects or isolated real-dogfood temp state.

## UX TODOs

- The TUI should show an explicit refresh-in-progress state while a manual `Z` refresh is reconciling observer state, so slow refreshes do not look like dropped input.

## Diagnostics Gaps

- Diagnostic file retention is reported through `wosm doctor`, but log and debug-bundle cleanup is not currently wired to the retention policy.
- A malformed JSONL log line can cause diagnostics collection to fail instead of skipping the bad record and preserving the remaining logs.
- Debug bundles write `logs/observer.jsonl`, but the manifest `sections` list does not currently name that nested log file.

## Test Coverage Gaps

- `packages/provider-hooks` has focused delivery and autostart-lock tests, but lacks direct coverage for stale socket removal, child cleanup after observer startup timeout, missing observer entry path failures, and stdin byte-limit enforcement.
- `packages/observability` has redaction and evidence-index tests, but lacks focused regression coverage for malformed JSONL log handling, retention enforcement wiring, and manifest completeness for nested bundle files.
