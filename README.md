# wosm

wosm is a local, terminal-native control plane for AI-agent worktree sessions.

It keeps configured projects, Worktrunk worktrees, tmux workspaces, and agent
harnesses connected through one CLI and TUI. The observer process owns runtime state,
the CLI handles commands and diagnostics, and the TUI gives you a live view of your
projects and sessions.

## Status

wosm is under active development. The current build supports local setup, diagnostics,
Worktrunk reconciliation, JSON snapshots, and the TUI shell. The public workflow is
usable for smoke testing, but interfaces may still change.

## Requirements

- Node.js 24.x
- pnpm 11
- Worktrunk, when using the Worktrunk provider
- tmux, when opening terminal workspaces
- Codex or OpenCode, when using those harness providers

On macOS, the repo includes a `Brewfile` and setup script for external tools.

## Quick Start

```sh
pnpm install
pnpm setup:system:check
pnpm setup:system --yes
pnpm build
pnpm wosm doctor
```

Use the example config as a starting point, then edit the project roots for your
machine:

```sh
mkdir -p ~/.config/wosm
cp examples/config.toml ~/.config/wosm/config.toml
```

Then reconcile projects, inspect the observer snapshot, and launch the TUI:

```sh
pnpm wosm reconcile --reason manual
pnpm wosm snapshot --json
pnpm wosm
```

To install the local CLI as `wosm` while developing:

```sh
pnpm wosm:link
wosm doctor
```

## Common Commands

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:diagnostics
pnpm test:agent:scripted
pnpm test:all
```

## Documentation

- [Manual smoke testing](docs/manual-smoke.md)
- [System dependencies](docs/system-dependencies.md)
- [Diagnostics](docs/diagnostics.md)
- [Example config](examples/config.toml)
- [Planning docs](docs/README.md)
