# Local Use Checklist

Use this checklist before relying on wosm for day-to-day local agent work.

## Machine Readiness

- `pnpm build` succeeds.
- `pnpm smoke:release` succeeds against isolated fake/scripted state.
- `pnpm setup:system:check` succeeds.
- `codex login status` succeeds (or `claude --version` plus `claude auth status` when using the Claude harness).
- `wt --version`, `tmux -V`, and `bin/wosm doctor` succeed for the local-real config.
- `examples/local-real-config.toml` has been copied and edited for the local use project root.
- Guided `wosm setup` has either linked global launchers or generated tmux/hook commands with checkout launcher paths.
- Worktrunk lifecycle hooks and the selected agent hooks were accepted during setup, or intentionally deferred.
- Inside tmux, `Ctrl-b Space` opens the WOSM popup without needing to restart tmux.
- The local-real config uses `managed_root = "~/.worktrees"` and omits `profile = "default"` unless
  that Codex profile has been created locally.
- `pnpm agent:cleanup` and `pnpm agent:reset` have been dry-run before destructive real E2E cleanup;
  use `-- --yes` only when the listed worktrees/processes are safe to remove.

## Real E2E Gate

Run:

```bash
WOSM_REAL_E2E=1 \
WOSM_REAL_WORKTRUNK=1 \
WOSM_REAL_CODEX=1 \
WOSM_WORKTRUNK_BIN="$(command -v wt)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
WOSM_CODEX_BIN="$(command -v codex)" \
pnpm test:e2e:real
```

Add `WOSM_REAL_CLAUDE=1` (with `claude` installed and logged in) to also run the opt-in
Claude lifecycle and hook lanes in the same run:

```bash
WOSM_REAL_CLAUDE=1 WOSM_CLAUDE_BIN="$(command -v claude)" \
WOSM_REAL_E2E=1 WOSM_REAL_WORKTRUNK=1 \
pnpm vitest run --config config/vitest/vitest.real-e2e.config.ts \
  tests/e2e/real/real-session-lifecycle-claude.test.ts \
  tests/e2e/real/real-claude-hooks.test.ts
```

Confirm:

- Observer starts, reports status, reconciles, snapshots, writes a debug bundle, and stops.
- `session.create` creates a real Worktrunk worktree, opens a real tmux target in the background, launches Codex, and writes the sentinel file.
- A real project-local Codex hook fires from the launched Codex process, calls `wosm-ingress codex`, and appears in observer `events.jsonl` as `harness.eventReported` for provider `codex`.
- `session.startAgent` works on an existing Worktrunk worktree without stealing focus from the TUI.
- `terminal.focus`, TUI Enter/numeric focus, close, and remove commands route through observer commands.
- Popup navigation opens the real TUI in a tmux popup over a wosm-created Codex agent pane, then slot activation exits the popup onto that same agent pane.
- Hooks deliver online, auto-start offline, spool when auto-start is disabled, and drain on startup.
- SQLite deletion still allows partial graph recovery from real providers.
- Stale tmux target failures leave command, provider-health, event, and debug-bundle evidence.

## Manual Product Loop

- Start with a disposable or temporary project.
- Run `wosm doctor`, `wosm reconcile --reason local-use`, and `wosm snapshot --json`.
- Launch `wosm tui`.
- Press `n`, create a branch/session, and confirm the TUI stays visible while the tmux workbench window opens in the background.
- Verify the worktree appears in snapshots and the primary pane current command is Codex or the Codex runtime, not an idle shell with a typed `cd && env && codex` command.
- Launch bare `wosm` from inside the workbench, or the `Ctrl-b Space` binding if installed, and select the agent row; the popup should close only after focus succeeds.
- If bare `wosm` is not linked, use the setup-reported checkout launcher path or run `pnpm wosm:link` before testing from arbitrary directories.
- Exercise focus and cleanup keys only on disposable rows.
- Stop the observer with `wosm observer stop`.

Never point destructive cleanup experiments at an active worktree with changes you care about.
