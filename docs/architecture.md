# Architecture

Status: current living doc for ordinary architecture and boundary decisions.

Use [Naming](naming.md) for provider hook, provider hook ingress, harness event report, WOSM event, and observer event hook terminology.

wosm is a local-first, terminal-native control plane for AI-agent worktree sessions. It keeps repositories, worktrees, terminal targets, provider hooks, agent runs, commands, and diagnostics on the developer machine.

## Current Shape

The main runtime model is:

```text
config declares managed projects and defaults
providers observe external systems
observer correlates provider truth into snapshots and commands
protocol exposes observer APIs over a local NDJSON Unix socket
CLI starts, controls, and debugs the system
TUI renders snapshots/events and submits typed commands
```

The repo is organized around these boundaries:

- `apps/observer` owns runtime correlation, reconciliation, command routing, provider health, persistence, hook ingestion, harness ingress queuing, diagnostics, and snapshot publication.
- `apps/cli` owns the `wosm` command surface: observer lifecycle, setup/doctor, reconcile/snapshot, hooks, debug trace, debug bundles, and TUI entrypoints.
- `apps/tui` owns terminal UI state and interaction. It consumes observer snapshots/events through `@wosm/protocol` and must not call providers directly.
- `packages/contracts` owns shared schemas and types for commands, events, snapshots, observations, providers, hooks, diagnostics, and safe errors.
- `packages/protocol` owns the local observer transport and validates request, response, and event messages.
- `packages/runtime` owns shared runtime boundary helpers for timeouts, retry, cancellation, external commands, and typed error conversion.
- `packages/provider-hooks` owns the tiny `wosm-ingress` sender, provider hook compaction/reporting, and offline spool writes for generated command hooks.
- `packages/config`, `packages/observability`, and `packages/testing` are shared support packages.
- `integrations/...` adapt external tools: Worktrunk, tmux, Codex, Cursor, Pi, OpenCode, scripted harnesses, and GitHub repository metadata.

## Source Of Truth

No single layer owns all truth.

- Config is authoritative for the projects wosm manages, project defaults, provider choices, and safe local policy.
- Worktree providers are authoritative for external worktree existence and worktree metadata they can prove.
- Terminal providers are authoritative for terminal topology and provider-owned target identity.
- Harness providers are authoritative for agent launch, discovery, event ingestion, and status signals they can prove.
- Repository providers are authoritative only for code-host metadata they fetch or cache through their integration boundary.
- Observer SQLite is durable observer memory for commands, events, correlations, provider observations, and current metadata cache rows.
- Observer snapshots are the normalized current graph exposed to clients.
- JSONL logs and debug bundles are diagnostic evidence, not runtime truth.

When these disagree, reconcile from config, providers, and current observer state first. Treat stale logs, old bundles, and historical plans as evidence to inspect, not as authority.

## Boundary Rules

- Provider-specific behavior stays in `integrations/...` or provider-injected capabilities. Observer/core code aggregates through contracts, registries, and provider interfaces.
- The TUI is a client. It renders snapshots/events and dispatches typed commands; it must not import providers, read SQLite, run `wt`, run `tmux`, run `git`/`gh`, or parse raw provider payloads for core behavior.
- The CLI is the command/debug entrypoint, but long-lived runtime correlation belongs in the observer.
- `packages/contracts` defines shared language with strict schemas for untrusted input and shared payloads.
- The protocol validates transport messages and keeps consumer APIs simple. It should not become a provider boundary.
- Effect/runtime usage belongs at IO, orchestration, timeout, retry, cancellation, queue, and external-command boundaries. Prefer Effect when one block combines async streams or subscriptions with cancellation, cleanup, retry/reconnect, timeout, queueing, or typed error mapping. Pure schemas, mappers, selectors, fixtures, and React/Ink presentation components should stay plain TypeScript.
- Provider hooks are ingress notifications and fast status reports. They can trigger persistence, projection, spool fallback, or scheduled reconcile, but they are not authoritative graph truth by themselves. Observer event hooks are configured commands triggered by WOSM events and should not be conflated with provider hook ingress.
- Terminal topology is provider-owned. Shared contracts and TUI behavior should express product intent where possible, not provider target mechanics.

## Conflict Rule

For ordinary work, current code, current tests, package scripts, runtime evidence, and these living docs supersede old planning baselines.

Use `docs/planning/historical/wosm_rebuild_tdd_final_v1.md` only for explicit historical rationale or when comparing old baseline assumptions with current behavior.

When a living doc conflicts with current code or tests, verify the runtime/code path and update the doc in the same change if the doc is stale.
