# Real Dogfood E2E

This suite runs `bin/wosm` against real config TOML, a real observer process, a real Unix socket, real SQLite state, real Worktrunk, real tmux, and real Codex. The Codex hook test creates an isolated temporary `CODEX_HOME`, appends inline hook config there, launches Codex with hooks enabled and hook trust bypassed for that temp project, and verifies `wosm hook codex ...` reaches the observer.

It is intentionally excluded from `pnpm test:e2e` and `pnpm test:all`.

## Prerequisites

```bash
pnpm build
pnpm setup:system:check
codex login status
```

Run with explicit flags:

```bash
WOSM_REAL_DOGFOOD=1 \
WOSM_REAL_WORKTRUNK=1 \
WOSM_REAL_CODEX=1 \
WOSM_WORKTRUNK_BIN="$(command -v wt)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
WOSM_CODEX_BIN="$(command -v codex)" \
pnpm test:e2e:real
```

For local dogfood from this repository, use the wrapper scripts instead of inline shell variables:

```bash
pnpm test:e2e:real:local
pnpm test:e2e:real:codex-hooks
pnpm test:e2e:real:codex-hooks:keep-temp
```

The popup navigation test is part of the local dogfood lane. It creates a real Worktrunk worktree, starts a real Codex agent in the tmux workbench, opens the wosm TUI in a real tmux popup over that agent pane, injects a numeric activation key through the popup TTY, and verifies tmux lands back on the same primary agent pane after the popup exits.

## Isolation

Each test uses a temporary local clone of this repository, a temporary wosm config, a temporary Worktrunk config, a unique tmux workbench session, a unique observer socket, and a temporary SQLite state directory.

The active checkout is never passed to Worktrunk as the project root. Cleanup kills the unique tmux sessions, stops the observer, removes created Worktrunk branches/worktrees where possible, and removes the temp clone.

Set `WOSM_REAL_DOGFOOD_KEEP_TEMP=1` while debugging a failure to leave the observer, tmux session, Worktrunk state, and temp clone in place. Clean those resources manually after inspection.

## Failure Triage

On lifecycle failures, tests attempt to write `wosm debug bundle` under the test state directory. Start with:

- `provider-health.json`
- `commands.jsonl`
- `events.jsonl`
- `errors.jsonl`
- `logs/observer.jsonl`
- `diagnostic-index.json`

Real Codex can be slow or model-dependent. The prompts are bounded and target only sentinel files under `.wosm-dogfood/sentinels/` in the temp clone.

The Codex hook lane also writes raw hook payloads and hook delivery output into the test temp root. Use those alongside `events.jsonl` to confirm that `SessionStart` and `PostToolUse` came from the real Codex process and were ingested as `hook.ingested` events for provider `codex`.
