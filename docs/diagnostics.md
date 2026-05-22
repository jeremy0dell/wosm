# wosm Diagnostics

Phase 6 establishes the local diagnostic surface for fake-provider observer runs before real Worktrunk, tmux, Codex, or OpenCode integrations ship.

## Commands

```bash
wosm doctor
wosm debug bundle
```

`wosm doctor` connects to the observer, asks the observer for runtime health, and reports config, SQLite, provider health, hook spool, snapshot, logs, local state usage, and retention status.

`wosm debug bundle` asks the observer for a diagnostic snapshot, then writes a redacted bundle under the configured state directory.

When `defaults.worktree_provider = "worktrunk"`, doctor also validates Worktrunk binary availability and lifecycle hook setup. Missing `wt` degrades provider health with `WORKTRUNK_UNAVAILABLE`, the attempted command, any resolved path, version output when available, and an install hint. Missing, disabled, or untrusted Worktrunk hooks degrade the report with a `worktrunk-hooks` check. Provider command failures from `wt` are recorded through provider health and appear in doctor output, logs, and debug bundle provider-health evidence.

For the current direct terminal smoke loop, see [manual-smoke.md](manual-smoke.md).

## Manual Smoke

After building, the diagnostic surface can be checked with a throwaway fake-provider config:

```bash
tmpdir="$(mktemp -d /tmp/wosm-smoke-XXXXXX)"
mkdir -p "$tmpdir/state" "$tmpdir/run"

cat > "$tmpdir/config.toml" <<EOF
schema_version = 1
projects = []

[observer]
socket_path = "$tmpdir/run/observer.sock"
state_dir = "$tmpdir/state"

[defaults]
worktree_provider = "fake-worktree"
terminal = "fake-terminal"
harness = "fake-harness"
layout = "agent-shell"
EOF

node apps/cli/dist/main.js --config "$tmpdir/config.toml" doctor
node apps/cli/dist/main.js --config "$tmpdir/config.toml" debug bundle
node apps/cli/dist/main.js --config "$tmpdir/config.toml" observer stop
```

This starts the lazy observer, verifies doctor output, writes a debug bundle under `$tmpdir/state/diagnostics`, and stops the observer. It uses fake providers only and should not touch real project state. If a sandbox blocks Unix socket binding, run the smoke outside that sandbox.

## Local State

Default paths live under the observer state directory:

```text
observer.sqlite
logs/observer.jsonl
logs/cli.jsonl
logs/tui.jsonl
logs/hooks.jsonl
diagnostics/
spool/hooks/
```

SQLite remains observer-owned runtime history. CLI and TUI use protocol APIs and do not read SQLite as runtime truth. JSONL logs and debug bundles are diagnostic evidence only.

## Bundle Sections

The operational bundle includes:

```text
manifest.json
config-summary.json
observer-health.json
snapshot.json
provider-health.json
commands.jsonl
events.jsonl
errors.jsonl
logs/observer.jsonl
spool-summary.json
local-state.json
retention.json
redaction-report.json
README.txt
```

Command records, events, logs, and error envelopes carry `commandId`, `traceId`, and `spanId` where available.

## Retention Defaults

Default diagnostic retention is bounded and visible through `wosm doctor`:

```toml
[observability.retention]
max_days = 14
max_total_mb = 250
max_file_mb = 10
max_files_per_component = 5

[observability.retention.debug_bundles]
max_bundles = 10
max_days = 30
```

Phase 6 enforces file retention for logs and bundles created by this diagnostic surface. SQLite over-limit status is reported, but SQLite rows are not pruned in this phase.

## Redaction

SafeError output excludes stacks and raw provider payloads. Error envelopes and debug bundles may include internal details only after redaction. Secret-like keys, authorization headers, token-looking values, and command output snippets are redacted before being written to logs or bundles.

## Worktrunk Hook Setup

Worktrunk hooks are explicit and reversible:

```bash
wosm --config /path/to/config.toml worktrunk hooks plan
wosm --config /path/to/config.toml worktrunk hooks install --yes
wosm --config /path/to/config.toml worktrunk hooks doctor
wosm --config /path/to/config.toml worktrunk hooks uninstall --yes
```

The generated hook bodies only call `wosm hook worktrunk <event>` with the resolved wosm config path. They do not contain lifecycle logic. The installer backs up the Worktrunk config, preserves unrelated hook commands, and removes only generated wosm hook entries on uninstall.

Real Worktrunk E2E coverage is opt-in:

```bash
WOSM_REAL_WORKTRUNK=1 WOSM_WORKTRUNK_BIN="$(command -v wt)" pnpm test:e2e:worktrunk:real
```

Default test commands skip this lane because it requires a local external `wt` binary and isolated Worktrunk state.
