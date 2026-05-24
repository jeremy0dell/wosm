# Known Issues

These are accepted limitations for the Phase 18 dogfood milestone.

- Real E2E remains opt-in because it requires local Worktrunk, tmux, Codex login, model access, and isolated temporary projects.
- wosm is still a private workspace package. There is no public npm package, installer, or release artifact outside this repository.
- The scripted/fake-provider release smoke is deterministic, but it does not prove a real Codex model response or real Worktrunk shell integration.
- The TUI does not include a row-level inspect/debug panel in v1. Use `wosm doctor`, `wosm snapshot --json`, and `wosm debug bundle` for support evidence.
- Real provider status can be conservative. Codex hooks can promote correlated live rows to working, needs attention, or idle, but terminal-only Codex rows may remain unknown until a reliable hook or provider status signal arrives.
- Worktrunk hook installation is explicit and reversible; it is not applied by `pnpm smoke:release`.
- Cleanup and remove workflows should be tested only against disposable projects or isolated real-dogfood temp state.
