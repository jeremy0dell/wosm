# Debugging

Status: current living entrypoint for runtime trace and diagnostic work.

## First Move

For runtime trace IDs, command IDs, and diagnostic IDs, start from runtime evidence under the configured observer state directory. Do not start by grepping checked-in source.

Use:

```bash
wosm debug trace <id>
wosm debug trace --latest-failure
wosm debug logs [query]
```

If a redacted bundle is needed, use:

```bash
wosm debug bundle --trace <traceId>
wosm debug bundle --command <commandId>
wosm debug bundle --latest-failure
```

## Tool Selector

Use the narrowest tool that can answer the question:

| Need | Command |
| --- | --- |
| Known trace, command, or diagnostic id | `wosm debug trace <id>` |
| No id yet, historical/local symptom | `wosm debug logs [query]` |
| Latest known failure | `wosm debug trace --latest-failure` |
| Process status only | `wosm observer status` |
| Current runtime health | `wosm doctor` |
| Current normalized graph | `wosm snapshot --json` |
| Current normalized graph with debug fields | `wosm snapshot --json --include-debug` |
| Live event stream for agents | `wosm observe --json --include-snapshot --duration 3s` |
| Live event stream for humans | `wosm observe --include-snapshot --duration 3s` or `wosm observe --pane` |
| One command lifecycle record | `wosm command get <commandId>` |
| Redacted shareable evidence | `wosm debug bundle --trace <traceId>` / `--command <commandId>` / `--latest-failure` |
| Provider hook setup | `wosm hooks doctor <target>` for worktrunk, codex, cursor, or opencode |
| Observer event hook setup | `wosm event-hooks doctor` |
| Setup and tool readiness | `wosm setup check --json`, `wosm setup system --check`, or `pnpm setup:system:check` |

Use `wosm debug logs [query]` for bounded historical log inspection when there is no
trace, command, or diagnostic ID yet. It reads structured JSONL logs from the
configured state directory without contacting the observer. By default it searches
`observer`, `cli`, and `tui` logs, excludes noisy hook logs, returns recent
`warn`/`error` records when no query is supplied, and searches all levels when a
query is supplied. Opt into hook logs explicitly:

```bash
wosm debug logs protocol
wosm debug logs --min-level error --limit 20
wosm debug logs timeout --component hook
```

Use current-truth tools only when the task permits live observer interaction.
`doctor`, `snapshot`, `observe`, `command get`, `reconcile`, and `debug bundle`
all contact the observer or start it when needed. `debug bundle` also writes a
new redacted bundle. `reconcile`, `command dispatch`, `project add/remove`,
hook install/uninstall, and setup apply commands intentionally mutate runtime,
config, hooks, or local machine state.

## No-Action Mode

If the user says "no action", keep debugging read-only.

Do not start or restart the observer, retry commands, kill processes, mutate state, or write a new bundle unless explicitly asked.

In no-action mode, inspect existing state only:

- `wosm debug trace <id>` or `wosm debug trace --latest-failure`
- `wosm debug logs [query]`
- existing bundles under `diagnostics/`
- existing logs under `logs/`
- existing bundle `commands.jsonl`, `errors.jsonl`, and derived indexes

Avoid live observer commands in no-action mode, including `doctor`, `snapshot`,
`observe`, `command get`, `command dispatch`, `reconcile`, `debug bundle`,
`project add/remove`, hook install/uninstall, setup apply, and observer
start/stop/restart/run. `wosm observer status` is non-mutating, but it is still a
live status check rather than an existing-state log read; use it only when live
status is allowed by the request.

## State Directory

The default observer state directory is:

```text
~/.local/state/wosm
```

It can be changed through config or observer startup options. The resolver also uses `$XDG_RUNTIME_DIR/wosm/observer.sock` for the socket when that environment variable is present.

Important files and directories:

```text
observer.sqlite
logs/observer.jsonl
logs/hooks.jsonl
logs/cli.jsonl
logs/tui.jsonl
diagnostics/*/diagnostic-index.json
diagnostics/*/commands.jsonl
diagnostics/*/errors.jsonl
diagnostics/*/logs/observer.jsonl
spool/hooks/
```

## Reading Evidence

- `diagnostic-index.json` is the fastest summary for root-cause codes and correlated evidence.
- `commands.jsonl` is the command lifecycle record.
- `errors.jsonl` carries safe error envelopes, diagnostic IDs, trace IDs, and provider context when available.
- `logs/observer.jsonl` and `logs/hooks.jsonl` explain runtime events around reconcile, command execution, hook delivery, projection, spool fallback, and provider health.
- SQLite is observer-owned runtime history; inspect through existing debug/diagnostic surfaces unless a task explicitly needs database-level investigation.
- Logs and bundles are diagnostic evidence only. Reconcile from config/providers/current observer state before treating old evidence as current truth.
- Provider hook logs are delivery/setup evidence, not runtime truth. Use observer health, reconcile output, and snapshots to verify the current graph.

## Detailed References

- Use `docs/diagnostics.md` for full doctor, debug bundle, redaction, retention, hook setup, and injected-failure details.
- Use `docs/manual-smoke.md` for runnable smoke loops, real Worktrunk and harness lanes, popup behavior, and cleanup smoke.
- Use `docs/system-dependencies.md` for setup, provider tools, and system dependency checks.
