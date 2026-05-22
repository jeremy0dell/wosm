# Manual Smoke Enablement

Phase 11.5 makes the current rebuild runnable enough for direct terminal testing. It does not make the TUI complete. The purpose is to start the real observer, reconcile configured projects through the selected providers, inspect a snapshot, and launch the TUI shell from the same command surface.

## Build

From the repository root:

```bash
pnpm install
pnpm build
```

Install external provider dependencies before using the real Worktrunk path:

```bash
pnpm setup:system:check
pnpm setup:system --yes
```

See [system-dependencies.md](system-dependencies.md) for the external dependency contract and command resolution order.

Use the repo-local command while developing:

```bash
pnpm wosm doctor
pnpm wosm reconcile --reason manual-smoke
pnpm wosm snapshot --json
pnpm wosm
```

To make `wosm` available as a bare command from another terminal pane:

```bash
pnpm wosm:link
wosm doctor
wosm reconcile --reason manual-smoke
wosm snapshot --json
wosm
```

If global linking is not desirable, add a shell function instead:

```bash
wosm() {
  pnpm --dir "$HOME/Developer/wosm" wosm "$@"
}
```

## Real Worktrunk Path

The runtime path is real Worktrunk. The observer constructs `WorktrunkProvider` when:

```toml
[defaults]
worktree_provider = "worktrunk"
```

and it uses `worktree.worktrunk.command`, `WOSM_WORKTRUNK_BIN`, or `wt` in that order.

If `wt` is missing, `wosm doctor` reports `WORKTRUNK_UNAVAILABLE` with the attempted command and install hint. The TUI blocks the new-session prompt while the selected project's worktree provider is unavailable, so `n` should fail before it dispatches `session.create`.

wosm can restrict each project to a managed Worktrunk directory. This keeps `main`, Codex temporary worktrees, and sibling worktrees out of the main TUI rows while still letting diagnostics report orphaned terminal targets:

```toml
[projects.worktrunk]
enabled = true
base = "main"
managed_root = ".worktrees"
include_main = false
include_external = false
```

With this policy, wosm-created worktrees are directed to `PROJECT_ROOT/.worktrees/{{ branch | sanitize }}` through Worktrunk's `WORKTRUNK_WORKTREE_PATH` setting.

A minimal config for the current manual test target is:

```toml
schema_version = 1

[observer]
socket_path = "~/.local/state/wosm/observer.sock"
state_dir = "~/.local/state/wosm"

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "codex"
layout = "agent-shell"

[worktree.worktrunk]
command = "wt"
use_lifecycle_hooks = false
hook_mode = "disabled"

[terminal.tmux]
session_prefix = "wosm"

[harness.codex]
enabled = true
command = "codex"

[[projects]]
id = "wosm"
label = "wosm"
root = "~/Developer/wosm"
default_branch = "main"

[projects.defaults]
harness = "codex"
terminal = "tmux"
layout = "agent-shell"

[projects.worktrunk]
enabled = true
base = "main"
managed_root = ".worktrees"
include_main = false
include_external = false
```

Place it at `~/.config/wosm/config.toml`, or pass it explicitly with `--config /path/to/config.toml`.

## Smoke Loop

Run this sequence before opening the TUI:

```bash
wosm doctor
wosm reconcile --reason manual-smoke
wosm snapshot --json
```

Expected basics:

- `doctor` starts or connects to the observer and reports provider health.
- `reconcile` asks the observer to read Worktrunk state for each configured project.
- `snapshot --json` returns the current project and worktree rows as JSON.

Then launch:

```bash
wosm
```

No subcommand defaults to the TUI. `wosm tui` is equivalent. TUI startup performs one observer reconcile with reason `tui-startup` before rendering, so the first screen is based on a fresh snapshot.

Stop the background observer when done:

```bash
wosm observer stop
```

## Hook Smoke

With the fake-provider config above, hook delivery can be checked without touching real Worktrunk state:

```bash
wosm hook worktrunk post-create <<< '{"branch":"feature/manual-hook"}'
wosm doctor
wosm debug bundle
```

Expected basics:

- The hook command reports `ingested` when the observer is reachable or can be auto-started.
- `doctor` reports hook spool depth; it should remain zero for successful delivery.
- `debug bundle` includes redacted hook log evidence from `logs/hooks.jsonl`.

## Cleanup Smoke

Exercise cleanup commands only against throwaway fake-provider state or an isolated temporary
Worktrunk project. Do not manually test removal against an active repository or worktree that has
uncommitted work you care about.

For the fake-provider smoke config from [diagnostics.md](diagnostics.md), use the TUI cleanup keys on
disposable rows only:

```text
a  close agent
t  close terminal
c  close all
x  remove worktree
```

The observer should reject dirty or active-agent worktree removal unless the confirmed command carries
`force = true`. After a cleanup failure, run:

```bash
wosm debug bundle
```

and check the bundle for the command id, trace id, `command.failed`, and cleanup-specific SafeError.

## Test-Only Fake Worktrunk

The e2e smoke test uses `tests/support/fake-external-tools/worktrunk-bin.ts` to create a deterministic executable that behaves like the tiny subset of `wt` needed by the provider. That fixture is for tests and examples only. It is not on the production code path, and it does not replace the real Worktrunk provider.

## Real Codex Smoke

The real Codex lane is opt-in and isolated from normal CI. It requires installed `tmux`, installed `codex`, and `codex login status` returning success.

```bash
codex login status
WOSM_REAL_CODEX=1 \
WOSM_CODEX_BIN="$(command -v codex)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
pnpm test:e2e:codex:real
```

The test uses a temporary project/worktree plus a temporary Codex shim that records argv and then executes the real Codex binary. The expected observer result is a normalized Codex harness run with conservative `unknown` low-confidence status.
