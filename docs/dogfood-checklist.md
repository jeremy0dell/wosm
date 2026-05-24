# Dogfood Checklist

Use this checklist before relying on wosm for day-to-day local agent work.

## Machine Readiness

- `pnpm build` succeeds.
- `pnpm smoke:release` succeeds against isolated fake/scripted state.
- `pnpm setup:system:check` succeeds.
- `codex login status` succeeds.
- `wt --version`, `tmux -V`, and `bin/wosm doctor` succeed for the dogfood config.
- `examples/dogfood-config.toml` has been copied and edited for the local dogfood project root.
- The dogfood config uses `managed_root = "~/.worktrees"` and omits `profile = "default"` unless
  that Codex profile has been created locally.
- `pnpm agent:cleanup` and `pnpm agent:reset` have been dry-run before destructive dogfood cleanup;
  use `-- --yes` only when the listed worktrees/processes are safe to remove.

## Real E2E Gate

Run:

```bash
WOSM_REAL_DOGFOOD=1 \
WOSM_REAL_WORKTRUNK=1 \
WOSM_REAL_CODEX=1 \
WOSM_WORKTRUNK_BIN="$(command -v wt)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
WOSM_CODEX_BIN="$(command -v codex)" \
pnpm test:e2e:real
```

Confirm:

- Observer starts, reports status, reconciles, snapshots, writes a debug bundle, and stops.
- `session.create` creates a real Worktrunk worktree, opens a real tmux target in the background, launches Codex, and writes the sentinel file.
- A real project-local Codex hook fires from the launched Codex process, calls `wosm hook codex ...`, and appears in observer `events.jsonl` as `harness.eventReported` for provider `codex`.
- `session.startAgent` works on an existing Worktrunk worktree without stealing focus from the TUI.
- `terminal.focus`, TUI Enter/numeric focus, close, and remove commands route through observer commands.
- Popup navigation opens the real TUI in a tmux popup over a wosm-created Codex agent pane, then slot activation exits the popup onto that same agent pane.
- Hooks deliver online, auto-start offline, spool when auto-start is disabled, and drain on startup.
- SQLite deletion still allows partial graph recovery from real providers.
- Stale tmux target failures leave command, provider-health, event, and debug-bundle evidence.

## Manual Product Loop

- Start with a disposable or temporary project.
- Run `wosm doctor`, `wosm reconcile --reason dogfood`, and `wosm snapshot --json`.
- Launch `wosm tui`.
- Press `n`, create a branch/session, and confirm the TUI stays visible while the tmux workbench window opens in the background.
- Verify the worktree appears in snapshots and the primary pane current command is Codex or the Codex runtime, not an idle shell with a typed `cd && env && codex` command.
- Launch bare `wosm` from inside the workbench, or the `Ctrl-b Space` binding if installed, and select the agent row; the popup should close only after focus succeeds.
- Exercise focus and cleanup keys only on disposable rows.
- Stop the observer with `wosm observer stop`.

Never point destructive cleanup experiments at an active worktree with changes you care about.
