# Install

This setup path is for a local development checkout. wosm remains a private workspace package for this milestone; there is no public npm package or publish flow yet.

## Requirements

- Node.js 24.x
- pnpm 11
- Worktrunk `wt` for real Worktrunk workflows
- tmux for the reference terminal provider and popup local-use path
- Codex, Cursor, Pi, or OpenCode only when running those real harness providers

## Fresh Checkout

From the repository root:

```bash
pnpm install
pnpm build
pnpm wosm setup
pnpm smoke:release
```

After WOSM is installed:

```text
WOSM is installed.

Next:
  wosm setup

This configures the core local workflow: Worktrunk, tmux, one agent CLI, and your first project.
Optional integrations can be added later.
```

`pnpm smoke:release` builds by default, creates an isolated temporary config, runs `bin/wosm doctor`, `reconcile`, `snapshot --json`, `debug bundle`, and the scripted-agent lane, then stops the observer and removes the temp state.

Useful smoke options:

```bash
pnpm smoke:release -- --skip-build
pnpm smoke:release -- --skip-scripted
pnpm smoke:release -- --keep-temp
```

## Local Command

During development, either use the repo-local command:

```bash
pnpm wosm doctor
pnpm wosm reconcile --reason manual
pnpm wosm snapshot --json
pnpm wosm
```

or link the built CLI after setup:

```bash
pnpm wosm:link
wosm doctor
```

## Local Real Config

Prefer `wosm setup` for a first real config. Use [examples/local-real-config.toml](../examples/local-real-config.toml) only when you want to manually edit a fuller real-tool starting point. Copy it to `~/.config/wosm/config.toml`, update the project root, and keep the managed Worktrunk root policy unless you intentionally want to show main or external worktrees.

```bash
mkdir -p ~/.config/wosm
cp examples/local-real-config.toml ~/.config/wosm/config.toml
```

Run `wosm doctor` after editing the config. Doctor should report config diagnostics, Worktrunk availability, hook setup status, SQLite health, provider health, local-state retention, and debug-bundle availability.
