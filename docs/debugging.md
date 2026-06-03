# Debugging

Status: current living entrypoint for runtime trace and diagnostic work.

## First Move

For runtime trace IDs, command IDs, and diagnostic IDs, start from runtime evidence under the configured observer state directory. Do not start by grepping checked-in source.

Use:

```bash
wosm debug trace <id>
wosm debug trace --latest-failure
```

If a redacted bundle is needed, use:

```bash
wosm debug bundle --trace <traceId>
wosm debug bundle --command <commandId>
wosm debug bundle --latest-failure
```

## No-Action Mode

If the user says "no action", keep debugging read-only.

Do not start or restart the observer, retry commands, kill processes, mutate state, or write a new bundle unless explicitly asked.

In no-action mode, inspect existing state only: existing bundles, existing logs, existing SQLite-derived exports, and existing command/error records.

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

## Detailed References

- Use `docs/diagnostics.md` for full doctor, debug bundle, redaction, retention, hook setup, and injected-failure details.
- Use `docs/manual-smoke.md` for runnable smoke loops, real Worktrunk and harness lanes, popup behavior, and cleanup smoke.
