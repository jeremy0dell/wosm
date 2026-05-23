# Phase 18 Dogfood Milestone

Phase 18 dogfood milestone prepares wosm for a serious local dogfood checkpoint without expanding product scope.

Checkpoint name: `phase-18-dogfood-milestone`.

## Added

- Deterministic `pnpm smoke:release` command for fresh-checkout validation.
- Install docs for Node.js 24.x, pnpm 11, system dependency checks, build, doctor, smoke, and local CLI use.
- Safe dogfood example config at `examples/dogfood-config.toml`.
- Known issues and release-readiness docs that separate deterministic CI from opt-in real dogfood lanes.
- Doctor hardening for provider health and provider-contributed diagnostic checks before release smoke.

## Validation

- Deterministic gate remains fake/scripted and local.
- Real Worktrunk, tmux, and Codex dogfood lanes remain opt-in.
- Debug bundles remain redacted and available for support evidence.

## Not Included

- No public npm package.
- No provider expansion.
- No broad refactor.
- No automatic git tag or publish step.
