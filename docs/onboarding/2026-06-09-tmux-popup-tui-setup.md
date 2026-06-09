# 2026-06-09: Tmux Popup TUI Setup — Diagnostic Transcript

## Summary

This doc records the initial setup and troubleshooting of the wosm tmux popup (`Ctrl-b Space`) and TUI session status ("unknown" → working/idle). Covers everything from a clean clone through popup activation and opencode status integration.

## Diagnostic Chain

### 1. `wosm-tmux-popup` returned 127 (command not found)

**Root cause:** Tmux's `run-shell -b` invokes `sh -c` with a minimal `PATH` inherited from the tmux server. The `wosm-tmux-popup` binary (declared in `package.json` as `./integrations/terminal/tmux/bin/wosm-popup`) was not on tmux's PATH.

**Evidence:**
- Interactive shell PATH (long, includes pnpm dirs): `echo $PATH`
- Tmux global PATH (minimal, `/usr/local/bin` etc.): `tmux show-environment -g PATH`

**Fix:**
```sh
mkdir -p ~/.local/bin
ln -sf /Users/wosmdogfood/.worktrees/wosm/wosm-9637a5/integrations/terminal/tmux/bin/wosm-popup ~/.local/bin/wosm-tmux-popup
tmux set-environment -g PATH "$HOME/.local/bin:$PATH"
```

Make permanent by adding to `~/.tmux.conf`:
```
set-environment -g PATH "$HOME/.local/bin:$PATH"
```

### 2. `wosm-tmux-popup` returned 1 (script runs but fails)

**Root cause:** The popup launcher script resolves its checkout root, finds no registered fast-popup UI session, and falls back to `$root/bin/wosm popup`. The `bin/wosm` entry point checks for `apps/cli/dist/main.js` — which doesn't exist until `pnpm build`.

**Evidence:**
```sh
# bin/wosm logic (line 23-26):
if [ ! -f "$entry" ]; then
  printf '%s\n' "wosm has not been built. Run: pnpm build" >&2
  exit 1
fi
```

**Fix:**
```sh
pnpm build
```

### 3. TUI shows session status "unknown"

**Root cause:** The observer detects opencode processes running in tmux panes (via process discovery), but has no reliable status signal. Without an opencode agent state plugin, it can't distinguish "working", "idle", "needs_attention", etc., so it conservatively reports "unknown" with low confidence.

**Evidence from `wosm doctor`:**
```json
"agent": {
  "state": "unknown",
  "confidence": "low",
  "reason": "OpenCode run has no reliable OpenCode status signal yet."
}
```

**Key files referenced:**
- `apps/tui/src/eventReducer/eventReducer.ts:206-210` — "unknown" fallback label
- `apps/observer/src/reconcile/graph.ts:172` — agent state defaults
- `apps/observer/src/reconcile/statusProjection.ts:35` — "unknown" filtered out
- `packages/contracts/src/observations.ts:17-26` — AgentState enum
- `docs/known-issues.md:11` — status conservatism rationale

**Fix:**
```sh
/Users/wosmdogfood/.worktrees/wosm/wosm-9637a5/bin/wosm observer restart
/Users/wosmdogfood/.worktrees/wosm/wosm-9637a5/bin/wosm hooks install opencode --yes
```

This installs `~/.config/opencode/plugins/wosm-agent-state.js`, a JS plugin that hooks into opencode's event system and forwards status events to the observer over its Unix socket. Any running opencode sessions must be restarted to pick up the plugin.

Full plugin verification:
```sh
/Users/wosmdogfood/.worktrees/wosm/wosm-9637a5/bin/wosm hooks doctor opencode
```

## Current Config

Path: `~/.config/wosm/config.toml`

```toml
schema_version = 1

[observer]
socket_path = "~/.local/state/wosm/observer.sock"
state_dir = "~/.local/state/wosm"

[defaults]
worktree_provider = "worktrunk"
terminal = "tmux"
harness = "opencode"
layout = "agent-shell"
default_branch = "main"

[worktree.worktrunk]
command = "/opt/homebrew/bin/wt"
managed_root = "~/.worktrees"
base = "main"
include_main = false
include_external = false
use_lifecycle_hooks = false
hook_mode = "disabled"

[terminal.tmux]
command = "/opt/homebrew/bin/tmux"
session_prefix = "wosm"
topology = "workbench"
workbench_session = "wosm"
window_naming = "project-branch"
primary_agent_pane = true

[harness.opencode]
enabled = true
command = "opencode"

[[projects]]
id = "wosm"
label = "wosm"
root = "/Users/wosmdogfood/Projects/wosm"
```

## Tmux Binding

Added to `~/.tmux.conf` by `wosm setup` (wrapped in marker comments):

```
# >>> wosm popup binding >>>
bind-key Space run-shell -b 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=#{q:client_name} wosm-tmux-popup'
# <<< wosm popup binding <<<
```

The popup opens the TUI via fast-popup registration (no registered UI → falls back to `wosm popup` → attaches to the observer TUI session).

## Key Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm build` | Build all packages (tsc via turbo) |
| `pnpm wosm:link` | Global symlink for wosm binaries (needs pnpm bin dir in PATH) |
| `./bin/wosm tui` | Open TUI standalone |
| Ctrl-b Space | Tmux popup toggle (opens/closes TUI overlay) |
| `./bin/wosm doctor` | Full system health check |
| `./bin/wosm observer restart` | Restart observer (do after build) |
| `./bin/wosm hooks doctor opencode` | Check opencode plugin status |
| `./bin/wosm hooks install opencode --yes` | Install opencode status plugin |
| `./bin/wosm snapshot --json` | Current graph state (JSON) |
| `./bin/wosm observe --duration 3s --json` | Live event stream |

## Full Conversation Transcript

> **User:** what is this repo?
>
> **Assistant:** wosm — a local, terminal-native control plane for AI-agent worktree sessions. It tracks projects, worktrees, tmux workspaces, and agent harnesses through a CLI and TUI, keeping multi-session development legible and diagnosable.
>
> **User:** when I press ctrl + b + space instead of opening the TUI it opens a full pane overlay showing: 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=/dev/ttys003 wosm-tmux-popup' returned 127
>
> **Assistant:** [Diagnosed 127 as "command not found". Found `wosm-tmux-popup` is a bin entry pointing to `integrations/terminal/tmux/bin/wosm-popup`. Tmux run-shell uses a minimal PATH. Suggested `pnpm wosm:link`.]
>
> **User:** The following tool was executed by the user
>
> **Assistant:** [Ran `pnpm wosm:link`. Failed because pnpm global bin dir not in PATH.]
>
> **User:** didn't fix it
>
> **Assistant:** [Checked `echo $PATH` and `tmux show-environment -g PATH`. Tmux PATH lacks pnpm global dir. Created `~/.local/bin/`, symlinked `wosm-tmux-popup` there, used `tmux set-environment -g PATH` to add it.]
>
> **User:** 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=/dev/ttys003 wosm-tmux-popup' returned 1
>
> **Assistant:** [Diagnosed exit code 1. Read `wosm-popup` launcher script (182 lines) and `bin/wosm` entry point. Found the fallback chain: launcher resolves root → `select_registered_ui()` → `fallback_or_exit()` → `$root/bin/wosm popup` → checks for `apps/cli/dist/main.js`. File doesn't exist → "wosm has not been built".]
>
> **User:** 'env WOSM_FOCUS_PROVIDER=tmux WOSM_FOCUS_CLIENT_ID=/dev/ttys003 wosm-tmux-popup' returned 1 now it shows this but still no TUI popup
>
> **Assistant:** [Tested `./bin/wosm popup` directly — confirmed "wosm has not been built".]
>
> **User:** nope still full pane overlay showing the same thing and not the tmux popup with the tui in it
>
> **Assistant:** [Checked that `apps/cli/dist/main.js` still didn't exist. Asked user to run `pnpm build`.]
>
> **User:** The following tool was executed by the user
>
> **Assistant:** [Ran `pnpm build`. All 18 packages built (turbo cached, 122ms). Verified `apps/cli/dist/main.js` now exists. Tested `./bin/wosm popup` — exits 0.]
>
> **User:** there it is
>
> **Assistant:** [Told user to try Ctrl-b Space again.]
>
> **User:** okay now it works but I don't see the TUI registering this session as working, it's still 'unknown'
>
> **Assistant:** [Explored TUI codebase for "unknown" origin. Found in `eventReducer.ts`, `graph.ts`, `statusProjection.ts`. Ran `wosm doctor` — showed opencode detected but "no reliable OpenCode status signal yet". Restarted observer. Installed opencode plugin via `wosm hooks install opencode --yes`.]
>
> **User:** The following tool was executed by the user
>
> **Assistant:** [Ran `wosm observer restart` (healthy, pid 32134) and `wosm hooks doctor opencode` (plugin not installed). Installed the plugin.]
>
> **User:** how did you diagnose this. what did you read to diagnose this. what was found here
>
> **Assistant:** [Explained the full diagnostic chain: 127 → PATH, 1 → not built, unknown → no opencode plugin.]
>
> **User:** add this and the full transcript of this convo to a todays date docs/onboarding/ doc for my future use and then push directly to main
