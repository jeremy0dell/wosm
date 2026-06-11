# System Dependencies

wosm ships Worktrunk, tmux, Claude Code, Codex, Cursor, Pi, and OpenCode as external provider integrations. They are not npm packages bundled into the workspace. The primary first-run path is:

```bash
wosm setup
```

This configures the core local workflow: Worktrunk, tmux, one agent CLI, and your first project. Optional integrations can be added later.

The local checkout also expects Node.js 24.x and pnpm 11 for development. Real-provider test lanes remain opt-in.
`wosm setup system --check` reports those versions, but it does not change the active Node or pnpm
installation automatically.

## Setup Commands

```bash
wosm setup
wosm setup check
wosm setup check --json
wosm setup plan
wosm setup plan --json
wosm setup apply --yes
wosm setup apply --dry-run
wosm setup system --check
wosm setup system --yes
```

Exit codes:

- `0`: required core setup is ready, or a read-only plan completed.
- `1`: required core setup is missing or an apply action failed.
- `2`: invalid setup command arguments.

`wosm setup check` and `wosm setup plan` are read-only. `wosm setup apply --dry-run` performs no writes or installs. Direct `wosm setup system` also requires an explicit mode: use `--check` for read-only reporting or `--yes` to apply Homebrew installs for missing Worktrunk and tmux.

## Dependency Tiers

Required for the default useful workflow:

- Worktrunk / `wt`
- tmux
- a git repository for the first project
- one supported agent CLI: Claude Code, Codex, Cursor Agent, OpenCode, or Pi

Recommended after setup:

- tmux popup binding (`Ctrl-b Space`) for opening and closing the dashboard overlay
- Worktrunk shell integration
- `wosm doctor`

Optional later:

- GitHub integration
- notifications
- extra harness CLIs
- provider hook installation, when not accepted during guided setup
- advanced tmux and popup tuning beyond the starter binding

## Worktrunk And Tmux

The Worktrunk provider shells out to `wt`. Install Worktrunk before using a config with:

```toml
[defaults]
worktree_provider = "worktrunk"
```

The tmux provider shells out to `tmux` for the workbench and popup local-use path. Guided
`wosm setup` can append a marked `Ctrl-b Space` binding to `~/.tmux.conf` when you accept the
recommended popup binding step. Inside tmux, setup can also load that binding into the current
tmux server so a restart or manual `tmux source-file ~/.tmux.conf` is not required.

The generated binding uses a resolved `wosm-tmux-popup` launcher. In a development checkout this
may be the checkout's `integrations/terminal/tmux/bin/wosm-popup` path rather than a bare command.
Run `pnpm wosm:link` only when you want bare `wosm`, `wosm-ingress`, and `wosm-tmux-popup` commands
available globally.

Use `terminal.tmux.command` when tmux is installed but not on the observer or popup launcher PATH:

```toml
[terminal.tmux]
command = "/opt/homebrew/bin/tmux"
```

On macOS, setup installs missing core tools directly when Homebrew is available:

```bash
wosm setup apply --yes
```

The compatibility script remains available for development checkouts:

```bash
pnpm setup:system:check
pnpm setup:system
```

`pnpm setup:system:check` delegates to `wosm setup system --check`. Bare `pnpm setup:system` is the development-checkout compatibility apply path and delegates to `wosm setup system --yes`. Dependency logic lives in the TypeScript CLI.

If the system check reports Node.js 22.x or pnpm 8.x, switch them deliberately with your normal
toolchain manager instead of letting setup mutate the machine:

```bash
fnm install 24 && fnm use 24
# or:
nvm install 24 && nvm use 24

corepack enable
corepack prepare pnpm@11.0.0 --activate
```

The upstream Worktrunk install docs currently recommend:

```bash
brew install worktrunk && wt config shell install
```

See https://worktrunk.dev/worktrunk/#install for other package managers.

## Resolution Order

The Worktrunk provider resolves the command in this order:

```text
worktree.worktrunk.command
WOSM_WORKTRUNK_BIN
wt
```

Use the config field when `wt` is installed but not on the observer's `PATH`:

```toml
[worktree.worktrunk]
command = "/opt/homebrew/bin/wt"
```

## Diagnostics

`wosm doctor` reports Worktrunk availability through provider health. When `wt` is missing, provider health includes:

```text
status = unavailable
lastError.code = WORKTRUNK_UNAVAILABLE
diagnostics.attemptedCommand
diagnostics.resolvedPath, when found on PATH
diagnostics.version, when available
diagnostics.installHint
```

The same provider-health evidence is included in `wosm debug bundle`, so a failed `session.create` can be tied back to the missing external binary.

## Hooks

Guided `wosm setup` can enable and install Worktrunk lifecycle hooks plus the selected Claude, Codex,
Cursor, or OpenCode agent hooks. The hook commands are generated with the resolved WOSM config path,
observer socket, state directory, spool directory, and `wosm-ingress` launcher. If you decline hook
setup, install later with:

```bash
wosm hooks install worktrunk --yes
wosm hooks install claude --yes
wosm hooks install codex --yes
wosm hooks install cursor --yes
wosm hooks install opencode --yes
```

Use the matching doctor commands to verify hook files and config intent:

```bash
wosm hooks doctor worktrunk
wosm hooks doctor claude
wosm hooks doctor codex
wosm hooks doctor cursor
wosm hooks doctor opencode
wosm event-hooks doctor
```

## Compatibility Script

```bash
pnpm setup:system:check
pnpm setup:system
pnpm setup:system --yes
pnpm setup:system --no-brew
```

Use `wosm setup` for user setup. Use `pnpm setup:system:check` when validating a development checkout's system dependencies, and `pnpm setup:system` when you want the compatibility wrapper to apply missing Homebrew installs.
