# Test Layout

Phase 0 keeps tests in predictable locations from the first commit.

- Workspace-local unit and integration tests live under `apps/*/test`, `packages/*/test`, or `integrations/*/*/test`.
- Cross-system tests live under top-level `tests/`.
- `tests/support/` is reserved for fake providers, fake external tools, temp projects, assertions, databases, and sockets.
- `tests/diagnostics/injected-failures/` contains deterministic diagnostic bundle and evidence-index coverage for common local failures.
- `tests/agent/scripted/` contains deterministic scripted-agent tests that can run in standard CI.
- `tests/agent/scenarios/diagnosis/` contains deterministic diagnostic-oracle fixtures for agent-style bundle classification.
- Real-agent tests are reserved for `tests/agent/real/` and are opt-in only.
- `tests/e2e/release-hardening-smoke.test.ts` covers the Phase 18 deterministic `pnpm smoke:release` path with fake Worktrunk state and scripted smoke disabled for focused e2e speed.
- `tests/support/fake-agent/` contains helpers for launching deterministic scripted harness plans in CI.
- `tests/e2e/worktrunk-real.test.ts` is an opt-in real Worktrunk lane. Run it only with `WOSM_REAL_WORKTRUNK=1` and an installed `wt` binary, optionally setting `WOSM_WORKTRUNK_BIN=/path/to/wt`. It is intentionally not part of `test:all`.
- `tests/agent/real/codex/` is an opt-in real Codex lane. Run it only with `WOSM_REAL_CODEX=1`, `codex login status` passing, and installed `tmux`, optionally setting `WOSM_CODEX_BIN=/path/to/codex` and `WOSM_TMUX_BIN=/path/to/tmux`. It is intentionally not part of `test:all`.
- `tests/e2e/real-dogfood/` is the Phase 16 product dogfood lane. Run it only with `WOSM_REAL_DOGFOOD=1`, `WOSM_REAL_WORKTRUNK=1`, `WOSM_REAL_CODEX=1`, real `wt`, real `tmux`, real `codex`, and a built `bin/wosm`. Use `pnpm test:e2e:real`, `pnpm test:e2e:real:local`, or focused scripts such as `pnpm test:e2e:real:codex-hooks`. It creates real Worktrunk/tmux/Codex sessions, opens the TUI in a real tmux popup for popup-navigation coverage, and includes a temp project-local Codex hook that calls `wosm-hook codex ...`. It is intentionally excluded from `test:e2e` and `test:all`.

No random floating tests should be added outside these directories.
