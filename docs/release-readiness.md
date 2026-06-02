# Release Readiness

Use GitHub `standard-ci` as the normal deterministic gate for pull requests and
`main` pushes. Keep release smoke, e2e, and real dogfood checks as local or
manual release gates.

## Standard CI Gate

The `standard-ci` workflow runs:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:diagnostics
pnpm test:agent:scripted
```

`standard-ci` must remain deterministic and must not require Worktrunk, tmux,
Codex login, model access, or network beyond dependency installation.

For local parity with the deterministic test lane:

```bash
CI=true pnpm install --frozen-lockfile --ignore-scripts
pnpm test:all
```

## Manual Release Gate

Run these locally or from an explicit release workflow when preparing a release
or dogfood checkpoint:

```bash
pnpm smoke:release
pnpm test:e2e
```

`pnpm smoke:release` and `pnpm test:e2e` use fake or scripted dependencies, but
they are release-readiness checks rather than the default PR gate.

## Real Dogfood Gate

```bash
pnpm setup:system:check
codex login status

WOSM_REAL_DOGFOOD=1 \
WOSM_REAL_WORKTRUNK=1 \
WOSM_REAL_CODEX=1 \
WOSM_WORKTRUNK_BIN="$(command -v wt)" \
WOSM_TMUX_BIN="$(command -v tmux)" \
WOSM_CODEX_BIN="$(command -v codex)" \
pnpm test:e2e:real
```

Real failures must have enough evidence to triage from `doctor`, `snapshot --json --include-debug`, provider health, command records, logs, and `debug bundle`. The real Codex hook lane must show compact `wosm-ingress` report evidence and observer `harness.eventReported` events for provider `codex`.

## Documentation Gate

- `docs/install.md` can take a fresh checkout through `pnpm install`, `pnpm build`, and `pnpm smoke:release`.
- `docs/manual-smoke.md` matches the current CLI commands.
- `docs/system-dependencies.md` names required external tools and override env vars.
- `tests/e2e/real-dogfood/README.md` lists real-lane flags, cleanup behavior, and triage files.
- `docs/dogfood-checklist.md` reflects the current manual dogfood loop.
- `docs/known-issues.md` lists accepted current dogfood limitations.
- `docs/release-notes/phase-18-dogfood-milestone.md` records the dogfood checkpoint.

## Release Notes Gate

- Known real-provider limitations are documented.
- Debug-bundle redaction remains enabled.
- Real E2E remains opt-in.
- No active checkout mutation is part of any release smoke or dogfood command.
- No public npm package is implied by the dogfood milestone.
