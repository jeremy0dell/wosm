# Manual Smoke Enablement

This is the current local manual smoke path for starting the observer, reconciling configured projects through selected providers, inspecting a snapshot, and launching the TUI from the same command surface.

## Build

From the repository root:

```bash
pnpm install
pnpm build
pnpm smoke:release
```

Install external provider dependencies before using the real Worktrunk path:

```bash
wosm setup
wosm setup check
```

See [system-dependencies.md](system-dependencies.md) for setup commands, exit codes, dependency tiers, and command resolution order. GitHub, notifications, extra harnesses, and provider hook installation are optional real-provider lanes, not part of the core first-run path.

Use the repo-local command while developing:

```bash
pnpm wosm doctor
pnpm wosm reconcile --reason manual-smoke
pnpm wosm snapshot --json
pnpm wosm observe --include-snapshot --duration 3s
pnpm wosm
```

To make `wosm` available as a bare command from another terminal pane:

```bash
pnpm wosm:link
wosm doctor
wosm reconcile --reason manual-smoke
wosm snapshot --json
wosm observe --include-snapshot --duration 3s
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

If `wt` is missing, `wosm doctor` reports `WORKTRUNK_UNAVAILABLE` with the attempted command and install hint. The TUI blocks the new-session prompt while the selected project's worktree provider is unavailable, so `N` should fail before it dispatches `session.create`.

wosm can restrict each project to a managed Worktrunk directory under a shared root. This keeps `main`, Codex temporary worktrees, and sibling worktrees out of the main TUI rows while still letting diagnostics report orphaned terminal targets:

```toml
[worktree.worktrunk]
managed_root = "~/.worktrees"
base = "main"
include_main = false
include_external = false
```

With this policy, wosm derives a per-project root under `~/.worktrees`, adding a stable suffix only when project IDs would otherwise collide, then gives each create command a concrete `WORKTRUNK_WORKTREE_PATH` with a collision-resistant branch segment.

`wosm setup` writes a minimal config like this for the current repository:

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
default_branch = "main"

[worktree.worktrunk]
command = "wt"
managed_root = "~/.worktrees"
base = "main"
include_main = false
include_external = false
use_lifecycle_hooks = false
hook_mode = "disabled"

[terminal.tmux]
session_prefix = "wosm"

[harness.codex]
enabled = true
command = "codex"

# Optional: configure Cursor as another selectable harness.
[harness.cursor]
enabled = true
command = "agent"

[[projects]]
id = "wosm"
label = "wosm"
root = "~/Developer/wosm"
```

Place it at `~/.config/wosm/config.toml`, or pass it explicitly with `--config /path/to/config.toml`.

Codex profiles are optional. Leave `profile` unset unless the named profile already exists in your
Codex config; `profile = "default"` is not portable and can make launch fail before the agent starts.

When Cursor is configured, the TUI new-session path is provider-neutral: press `N`, press `A` to open
the Agent picker, choose `cursor`, then press Enter to submit. Cursor should appear only when the
observer snapshot includes the configured `cursor` harness.

Cursor hook-driven state promotion requires manual Cursor hook configuration in `.cursor/hooks.json`
or `~/.cursor/hooks.json`; wosm does not install Cursor hooks yet. The hook command reads Cursor's
JSON payload from stdin and is ignored unless the Cursor process was launched by wosm with WOSM
ownership env.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }],
    "stop": [{ "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }],
    "sessionEnd": [{ "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }],
    "beforeShellExecution": [
      { "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }
    ],
    "afterShellExecution": [
      { "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }
    ],
    "preToolUse": [{ "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }],
    "postToolUse": [{ "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }],
    "postToolUseFailure": [
      { "command": "wosm-ingress --config ~/.config/wosm/config.toml cursor" }
    ]
  }
}
```

## Smoke Loop

Run this sequence before opening the TUI:

```bash
wosm doctor
wosm reconcile --reason manual-smoke
wosm snapshot --json
wosm observe --include-snapshot --duration 3s
```

Expected basics:

- `doctor` starts or connects to the observer and reports provider health.
- `reconcile` asks the observer to read Worktrunk state for each configured project.
- `snapshot --json` returns the current project and worktree rows as JSON.
- `observe --include-snapshot --duration 3s` prints a bounded live stream from the same observer snapshot and event truth.

Then launch:

```bash
wosm
```

Outside tmux, bare `wosm` defaults to the full TUI. `wosm tui` always opens the full TUI explicitly. TUI startup performs one observer reconcile with reason `tui-startup` before rendering, so the first screen is based on a fresh snapshot.

For TUI development, use the same command routing with a reloadable dev TUI:

```bash
pnpm wosm:tui-dev
```

This performs an initial build, keeps a Turbo build watcher running in the background, and runs
normal `wosm` placement with a watch-mode TUI command. Outside tmux it opens the full TUI in the
current terminal. Inside tmux it uses the normal popup path, but the persistent UI process runs under a
debounced watch runner so changes to rebuilt TUI code reload in place without restart storms. The dev
popup registers itself with tmux for that checkout root, so a normal `wosm popup` binding reopens the
active dev UI only while that `pnpm wosm:tui-dev` process remains alive and the popup was requested
from the same checkout. Keep the `pnpm wosm:tui-dev` process running while developing; press Ctrl-C
there to stop the build watcher, clear the tmux dev-popup registration, and stop that checkout's dev
popup session. Build watcher output is written to `.turbo/tui-dev-build.log`.

If a different checkout already has a live dev popup registered, `pnpm wosm:tui-dev` prints the
registered root, session, and owner, then asks whether to stop that process and start the dev UI from
the current checkout.

To force a fresh built TUI from the current checkout after switching worktrees or branches, using
the normal popup path inside tmux:

```bash
pnpm wosm:reset
```

Background-first create/start should keep the dashboard as the cockpit:

```text
N  Enter
N  E  edit the generated name  Enter  Enter
```

Expected behavior:

- The TUI remains visible and shows the command as queued or completed through observer events.
- A Worktrunk worktree is created under `~/.worktrees/<project-id>/<branch>`.
- A tmux workbench window opens in the background for that worktree.
- The primary pane runs Codex from the worktree path; wosm should not visibly type a
  `cd ... && env ... codex ...` command into a shell.
- Press the visible row slot (`1-9/a-z`) only when you explicitly want to focus that agent pane.

To reset stale local workbench state during manual smoke, clear the tmux workbench deliberately:

```bash
tmux kill-session -t wosm 2>/dev/null || true
```

For repeated agent-driven real E2E work, prefer the repo helper so cleanup remains scoped and
repeatable:

```bash
pnpm agent:cleanup
pnpm agent:cleanup:run
pnpm agent:reset
pnpm agent:reset -- --yes --force-worktrees --fix-config
```

`agent:cleanup` targets stale wosm tmux sessions, the local wosm observer, and temp real-e2e
processes. `agent:reset` also targets managed worktree directories under `PROJECT/.worktrees` and
`~/.worktrees/wosm`. Both scripts dry-run by default unless `--run` or `--yes` is supplied.

From inside the tmux workbench, popup navigation should behave like an overlay:

```bash
wosm
```

Inside tmux, bare `wosm` defaults to the popup dashboard. `wosm popup` is the explicit form, and `wosm tui` remains the full TUI. Select a focusable row with its visible slot (`1-9/a-z`). On success, the popup closes and tmux lands in the selected worktree window's primary agent pane. If focus fails, the popup stays open and shows the SafeError message plus any diagnostic ID.

wosm-created tmux workbench sessions set `mouse on`, `history-limit 100000`, and `set-clipboard on` on the workbench session so scrolling, mouse selection, and copy behavior are closer to a normal Ghostty terminal without changing global tmux defaults.

To make the old-style prefix binding call that same path, add a tmux binding and reload tmux:

```tmux
bind-key Space run-shell -b 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID="#{client_name}" wosm-tmux-popup'
```

Use the stable `wosm-tmux-popup` entrypoint, or a stable checkout's `bin/wosm-popup`, for tmux
bindings. Avoid binding directly to `.worktrees/.../bin/wosm-popup`: that keeps running the old
worktree's launcher code even after a branch or feature worktree is gone.

```bash
tmux source-file ~/.tmux.conf
```

Pressing `Ctrl-b Space` while no wosm popup is active opens the dashboard overlay on the active tmux client. Pressing the same binding while that overlay is active closes it.

Stop the background observer when done:

```bash
wosm observer stop
```

## Hook Smoke

With the fake-provider config above, hook delivery can be checked without touching real Worktrunk state:

```bash
wosm-ingress --config /path/to/config.toml worktrunk post-create <<< '{"branch":"feature/manual-hook"}'
wosm doctor
wosm debug bundle
```

Expected basics:

- The ingress sender exits quietly when the observer accepts the hook or the event is spooled.
- `doctor` reports hook spool depth; it should remain zero for successful delivery.
- `debug bundle` includes redacted hook log evidence from `logs/hooks.jsonl`.

## Cleanup Smoke

Exercise cleanup commands only against throwaway fake-provider state or an isolated temporary
Worktrunk project. Do not manually test removal against an active repository or worktree that has
uncommitted work you care about.

For the fake-provider smoke config from [diagnostics.md](diagnostics.md), use the TUI removal flow on
disposable rows only:

```text
X  choose a visible row slot  y
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

## Real Cursor Smoke

The real Cursor lane is opt-in and isolated from normal CI. It requires installed `tmux`, installed Cursor Agent `agent`, and `agent --version` returning success.

```bash
agent --version
WOSM_REAL_CURSOR=1 \
WOSM_CURSOR_AGENT_BIN="$(command -v agent)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
pnpm test:e2e:cursor:real
```

The test uses a temporary project/worktree plus a temporary Cursor shim that records argv/env and then executes the real Cursor Agent binary. It is a launch-only lane: the expected observer result is a normalized Cursor harness run with conservative `unknown` low-confidence status and tmux pane/process evidence that an interactive launch exists. It does not install or exercise Cursor hooks.

## Real E2E

The opt-in product real E2E lane drives the built `bin/wosm` CLI against real config TOML, a real observer process, real Unix socket, real SQLite file, real Worktrunk, real tmux, and real Codex. It uses a temporary clone of this repository and unique tmux/Worktrunk state, not the active checkout.

```bash
pnpm build
pnpm setup:system:check
codex login status

WOSM_REAL_E2E=1 \
WOSM_REAL_WORKTRUNK=1 \
WOSM_REAL_CODEX=1 \
WOSM_WORKTRUNK_BIN="$(command -v wt)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
WOSM_CODEX_BIN="$(command -v codex)" \
pnpm test:e2e:real
```

The suite covers observer start/status/reconcile/snapshot/debug bundle, real Worktrunk worktree creation, tmux workbench focus, Codex launch with bounded sentinel prompts, real Codex hooks from an isolated temporary `CODEX_HOME` calling `wosm-ingress codex`, Worktrunk hook delivery/spool/drain, restart recovery, SQLite deletion recovery, TUI key-driven control, and tmux popup navigation over a real wosm-created Codex agent pane. Failed lifecycle tests attempt to write a debug bundle under that test's temp state directory.

From the repo root, local wrapper scripts set the required real flags and binary paths automatically:

```bash
pnpm test:e2e:real:local
pnpm test:e2e:real:codex-hooks
pnpm test:e2e:real:codex-hooks:keep-temp
```
