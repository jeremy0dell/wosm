# wosm

wosm is a local, terminal-native control plane for AI-agent worktree sessions.

It is built for developers who run more than one agent, branch, worktree, or terminal
workspace at a time and want the whole system to stay legible. Instead of spreading
agent state across shell history, tmux panes, ad hoc scripts, and memory, wosm gives
those moving parts one local command surface and one live TUI.

The goal is simple: keep your projects, Worktrunk worktrees, tmux workspaces, and
agent harnesses connected without turning your development machine into a black box.
wosm tracks what it can prove, reports what it cannot prove, and keeps diagnostics
close enough that a failed session can be understood without spelunking through every
terminal tab.

## Why wosm?

AI coding tools are most useful when they can work in real project environments, but
that also makes them easy to lose track of. A few parallel tasks can quickly become a
pile of worktrees, panes, background processes, and half-remembered prompts.

wosm treats that as an orchestration problem. It keeps the core state in a local
observer, exposes operational commands through the CLI, and presents the current
picture in a terminal UI. The system is intentionally local-first: your repositories,
terminals, provider tools, and diagnostic state stay on your machine.

Use wosm when you want to:

- see configured projects and active worktrees in one place
- reconcile real Worktrunk state instead of guessing from directory names
- open tmux workspaces with stable identity attached
- launch agent harnesses such as Codex or OpenCode from a consistent flow
- inspect snapshots, provider health, hooks, logs, and debug bundles when something
  feels off

## Apps

The repo is organized around three local apps that work together.

### CLI

`@wosm/cli` provides the `wosm` command. It is the entry point for setup checks,
observer lifecycle, reconciliation, snapshots, hooks, diagnostics, and launching the
TUI. During development you can run it through `pnpm wosm`, or link it globally with
`pnpm wosm:link`.

Useful commands include:

```sh
wosm doctor
wosm reconcile --reason manual
wosm snapshot --json
wosm debug bundle
wosm observer stop
```

### Hook Runner

`@wosm/hook-runner` provides the small `wosm-hook` bridge used by generated provider
hooks. It parses hook stdin, reports to the observer with bounded delivery, and
spools locally if the observer is unavailable. The older `wosm hook <provider>
<event>` command remains available as a JSON-emitting compatibility wrapper.

### Observer

`@wosm/observer` is the local background process that owns runtime truth. It talks to
configured providers, reconciles project state, records bounded diagnostic evidence,
and serves snapshots/events/commands over the protocol layer.

The observer is deliberately the place where orchestration lives. The CLI and TUI ask
it questions and submit commands; they do not independently invent runtime state.
That boundary is what lets wosm stay debuggable as more providers and workflows are
added.

### TUI

`@wosm/tui` is the terminal UI. It is built for the moment when you want to stop
remembering which pane belongs to which agent and just look at the live system.

The TUI connects to the observer, refreshes from snapshots and events, and gives a
provider-neutral view of projects, worktrees, sessions, terminal targets, and agent
status. Running `wosm` with no subcommand launches it.

## Integrations

wosm is designed around provider boundaries so each external tool can stay in its own
lane.

- Worktrunk provides the real worktree backend through `wt`.
- tmux provides terminal workspaces and pane/window identity.
- Codex and OpenCode are harness providers for agent sessions.
- Scripted providers are used for deterministic tests and local contract coverage.

External tools are not bundled into the npm workspace. wosm checks and reports their
availability through `wosm doctor`, provider health, and debug bundles.

## Status

wosm is under active development. The current build supports local setup, diagnostics,
Worktrunk reconciliation, JSON snapshots, hook ingestion, debug bundles, and the TUI
shell. It is ready for manual smoke testing and early dogfooding, but interfaces may
still change.

## Requirements

- Node.js 24.x
- pnpm 11
- Worktrunk, when using the Worktrunk provider
- tmux, when opening terminal workspaces
- Codex or OpenCode, when using those harness providers

On macOS, the repo includes a `Brewfile` and setup script for external tools.

## Quick Start

Install dependencies, check system tools, build the workspace, and ask wosm to inspect
the local environment:

```sh
pnpm install
pnpm setup:system:check
pnpm setup:system --yes
pnpm build
pnpm smoke:release
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

- [Install](docs/install.md)
- [Manual smoke testing](docs/manual-smoke.md)
- [System dependencies](docs/system-dependencies.md)
- [Diagnostics](docs/diagnostics.md)
- [Example config](examples/config.toml)
- [Dogfood config](examples/dogfood-config.toml)
- [Known issues](docs/known-issues.md)
- [Phase 18 release notes](docs/release-notes/phase-18-dogfood-milestone.md)
- [Planning docs](docs/README.md)
