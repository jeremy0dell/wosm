# Install

This Phase 18 dogfood path is for a local development checkout. wosm remains a private workspace package for this milestone; there is no public npm package or publish flow yet.

## Requirements

- Node.js 24.x
- pnpm 11
- Worktrunk `wt` for real Worktrunk workflows
- tmux for the reference terminal provider and popup dogfood path
- Codex or OpenCode only when running those real harness providers

## Fresh Checkout

From the repository root:

```bash
pnpm install
pnpm setup:system:check
pnpm build
pnpm smoke:release
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

or link the built CLI:

```bash
pnpm wosm:link
wosm doctor
```

## Dogfood Config

Use [examples/dogfood-config.toml](../examples/dogfood-config.toml) as the safe real-tool starting point. Copy it to `~/.config/wosm/config.toml`, update the project root, and keep the managed Worktrunk root policy unless you intentionally want to show main or external worktrees.

```bash
mkdir -p ~/.config/wosm
cp examples/dogfood-config.toml ~/.config/wosm/config.toml
```

Run `wosm doctor` after editing the config. Doctor should report config diagnostics, Worktrunk availability, hook setup status, SQLite health, provider health, local-state retention, and debug-bundle availability.
