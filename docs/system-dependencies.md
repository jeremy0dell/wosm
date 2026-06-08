# System Dependencies

wosm ships Worktrunk, tmux, Codex, Cursor, Pi, and OpenCode as external provider integrations. They are not npm packages bundled into the workspace. The repo depends on them through provider contracts, runtime preflights, `wosm doctor`, and opt-in real-provider test lanes.

The local checkout also expects Node.js 24.x and pnpm 11. `pnpm setup:system:check` verifies those versions, Worktrunk, and tmux. Real harness binaries such as Codex, Cursor, Pi, and OpenCode are checked by their opt-in lanes and provider health.

## Worktrunk And Tmux

The Worktrunk provider shells out to `wt`. Install Worktrunk before using a config with:

```toml
[defaults]
worktree_provider = "worktrunk"
```

The tmux provider shells out to `tmux` for the workbench and popup local-use path.

On macOS, the repo `Brewfile` declares both dependencies:

```bash
pnpm setup:system:check
pnpm setup:system --yes
```

The setup command runs `brew bundle install` from the repo `Brewfile`, verifies `node --version`, `pnpm --version`, `wt --version`, and `tmux -V`, then runs `wt config shell install`. Omit `--yes` if you want to answer Worktrunk's shell integration prompt yourself.

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

## Script Options

```bash
pnpm setup:system:check
pnpm setup:system
pnpm setup:system --yes
pnpm setup:system --skip-shell-integration
pnpm setup:system --no-brew
```

Use `--check` before manual testing to verify the machine is ready without modifying shell configuration.
