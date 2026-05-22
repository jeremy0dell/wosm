# Release Readiness

Use this as the first dogfood/release gate.

## Deterministic Gate

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:diagnostics
pnpm test:agent:scripted
pnpm test:e2e
pnpm test:all
```

`pnpm test:all` must remain deterministic and must not require Worktrunk, tmux, Codex login, model access, or network.

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

Real failures must have enough evidence to triage from `doctor`, `snapshot --json --include-debug`, provider health, command records, logs, and `debug bundle`. The real Codex hook lane must show both raw Codex hook payload evidence and observer `hook.ingested` events for provider `codex`.

## Documentation Gate

- `docs/manual-smoke.md` matches the current CLI commands.
- `docs/system-dependencies.md` names required external tools and override env vars.
- `tests/e2e/real-dogfood/README.md` lists real-lane flags, cleanup behavior, and triage files.
- `docs/dogfood-checklist.md` reflects the current manual dogfood loop.

## Release Notes Gate

- Known real-provider limitations are documented.
- Debug-bundle redaction remains enabled.
- Real E2E remains opt-in.
- No active checkout mutation is part of any release smoke or dogfood command.
