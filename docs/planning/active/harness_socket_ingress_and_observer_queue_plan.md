# Harness Socket Ingress And Observer Queue Plan

**Status:** Phase 1 committed; Phase 2 implemented locally
**Date:** 2026-05-29
**Applies to:** harness integrations, provider hook delivery, observer ingress, protocol, persistence, diagnostics
**Supersedes:** `docs/planning/historical/harness_hook_ingress_refactor_master_plan.md` for future transport and observer backpressure work

This plan records the current runtime discoveries and the target architecture for replacing the `wosm-hook` hot path with a shared local ingress API and an observer-owned semantic agent state pipeline.

The goal is not to add one more package beside the old stack. The goal is to remove the CLI-shaped hook bridge from the high-frequency path and make the observer acknowledge harness events before slow persistence, projection, and reconciliation work.

## Decision

Adopt this shape:

```text
Pi extension / Codex hook / Claude hook / OpenCode plugin / heuristics
  -> same local wosm observer socket API
  -> same semantic agent state model
```

Provider integrations may keep provider-specific capture code because every provider exposes events differently. Once a provider has a semantic event or state report, delivery should be provider-neutral.

This is one architecture change with two implementation phases:

1. Remove the CLI/hook-runner delivery hot path.
2. Make observer ingress enqueue-first instead of doing observer work before ack.

Doing only the first phase leaves observer backpressure. Doing only the second phase leaves every high-frequency event paying process startup and config loading costs.

## Implementation Status

Phase 1 was committed as `7790cb7 Remove provider hook bridge hot path`.

Phase 2 is implemented in the current working tree:

- `observer.harnessEvent.report` now validates and enqueues before slow persistence, projection, and reconcile work.
- The observer owns a bounded in-memory harness ingress queue with report-id dedupe, stable-key coalescing, overflow rejection, async processing, and batched reconcile reasons.
- Hook spool report records enqueue into the same queue, and observer startup no longer waits for full spool drain completion.
- Observer health exposes harness ingress queue depth, enqueued, processed, coalesced, dropped, failed, last error, and last drain stats.
- Focused tests cover fast ACK under blocked processing, coalescing, spool startup non-blocking behavior, health metrics, and strict contract parsing.

Current verification:

```text
pnpm test:all
protocol profile with blocked queue worker:
  n=200
  p50 ~= 0.27ms
  p90 ~= 0.43ms
  queue depth before release: 1
  coalesced before release: 198

controlled blocking protocol handler with 25ms work:
  n=50
  p50 ~= 27.03ms
  p90 ~= 28.06ms
```

## Current Discoveries

Measured during the 2026-05-29 profiling session:

```text
wosm-hook -> fake observer accepted
  n=20
  p50 ~= 434ms
  p90 ~= 635ms
  mean ~= 445ms

direct protocol client -> fake observer accepted
  n=200
  p50 ~= 0.37ms
  p90 ~= 0.71ms
  mean ~= 0.55ms

persistent raw protocol connection -> fake observer accepted
  n=200
  p50 ~= 0.06ms
  p90 ~= 0.08ms
  mean ~= 0.08ms

wosm-hook -> live observer under Pi load
  3 samples around 1.1s to 1.6s
  spooled with protocol request timeouts

direct protocol client -> live observer under Pi load
  n=5
  p50 ~= 1.0s
  p90 ~= 3.1s
  mean ~= 1.29s
```

Interpretation:

- The Unix socket protocol is not inherently slow.
- The `wosm-hook` process/config/hook-bridge path costs hundreds of milliseconds even when observer is perfect.
- The live observer path is also too slow under Pi event load.
- The current system has both producer-side overhead and receiver-side backpressure.

## Current Runtime Shape

Codex currently takes this path:

```text
Codex command hook
  -> generated bash script
  -> temp payload file
  -> node -e extracts hook_event_name
  -> wosm-hook --config <config> codex <event>
  -> apps/hook-runner
  -> packages/hook-bridge command/receiver
  -> packages/protocol client
  -> observer.harnessEvent.report
  -> observer persists report/event observation
  -> observer projects status onto current snapshot
  -> observer schedules reconcile
  -> hook caller receives ack
```

Pi currently takes this path:

```text
Pi extension event callback
  -> spawn("wosm-hook", ...)
  -> packages/hook-bridge
  -> observer.harnessEvent.report
  -> same observer inline work
```

Worktrunk lifecycle hooks are lower-frequency, but they also keep the `wosm-hook` stack alive:

```text
Worktrunk hook
  -> wosm-hook --config <config> worktrunk <event>
  -> packages/hook-bridge
  -> observer.ingestHookEvent
```

That matters because deleting only the harness usages would still leave `apps/hook-runner`, `packages/hook-bridge`, `bin/wosm-hook`, package bin entries, installer tests, real-smoke assumptions, and docs.

## Target Runtime Shape

The target online path is:

```text
provider-specific capture
  -> compact provider-neutral report/state patch
  -> observer local Unix socket
  -> validate and enqueue
  -> immediate accepted/enqueued receipt
  -> queue worker coalesces by agent/session/worktree/turn/tool
  -> update semantic agent state
  -> publish focused state events
  -> persist selected durable facts
  -> schedule bounded validation reconcile when needed
```

The target offline path is:

```text
provider-specific capture
  -> observer socket unavailable or fast enqueue fails
  -> compact local spool record
  -> observer later drains spool into the same queue
```

Spool remains a durable fallback. It is not the normal queue and it is not the backpressure strategy for a running observer.

## Package And Removal Rule

Do not add `@wosm/harness-ingress` as an additional long-lived package while keeping `@wosm/hook-bridge` intact.

Allowed outcomes:

- Reuse `@wosm/protocol` plus provider integration code, and delete the old hook bridge pieces.
- Rename or replace `@wosm/hook-bridge` with a smaller ingress package in the same slice that removes hook-runner/CLI concepts.
- Move tiny shared path/spool helpers into an existing appropriate package only if doing so deletes the old package boundary.

Not allowed:

- `apps/hook-runner` remains.
- `packages/hook-bridge` remains.
- A new ingress package is added beside both.
- Generated provider hooks still call `wosm-hook`.
- The old `wosm hook <provider> <event>` command remains as a permanent alternate path.

Temporary compatibility is acceptable only as a migration slice with a delete criterion in the same plan.

## Semantic Agent State Model

The observer needs a current semantic state model that is separate from raw provider payloads and separate from full reconcile.

Sketch:

```ts
type SemanticAgentState = {
  provider: string;
  agentKey: string;
  projectId?: string;
  worktreeId?: string;
  sessionId?: string;
  harnessRunId?: string;
  state: "starting" | "working" | "idle" | "needs_attention" | "blocked" | "exited" | "unknown";
  confidence: "high" | "medium" | "low";
  reason?: string;
  activeToolName?: string;
  activeToolUseId?: string;
  turnId?: string;
  permissionRequestId?: string;
  lastEventType: string;
  source: "harness_event" | "harness_process" | "heuristic";
  observedAt: string;
  updatedAt: string;
};
```

The exact contract can differ, but these rules should hold:

- Raw provider payloads stay in integrations or redacted diagnostic storage.
- Observer snapshots consume semantic agent state, not provider-specific event blobs.
- Reconcile validates and correlates state, but individual hook events do not wait for full reconcile.
- High-frequency status changes can update the TUI before the next full provider scan.

## Phase 1 - Remove The CLI Delivery Hot Path

### Scope

Replace generated `wosm-hook` delivery with direct local observer ingress for Codex, Pi, Worktrunk, and future provider hooks/plugins.

This phase is primarily about producer-side overhead and code deletion. It should not redesign observer persistence beyond what is needed to keep the new sender working.

### Implementation Direction

1. Keep `observer.harnessEvent.report` as the provider-neutral harness report method unless a test proves a new method name is needed.
2. Add a minimal sender abstraction that provider integrations can call without loading CLI command parsing or `hook-bridge`.
3. For Pi and plugin-capable providers, use in-process delivery and keep a persistent or reusable socket where practical.
4. For Codex command hooks, accept that Codex invokes a command today, but make that command a tiny sender or session sidecar client, not `wosm-hook`.
5. For Worktrunk lifecycle hooks, migrate generated hook bodies to the same sender family or a provider-neutral event report method so `wosm-hook` is not kept alive for low-frequency events.
6. Preserve offline spool behavior, but write compact records only.

The Codex path can be staged:

```text
Stage 1:
  generated hook script -> tiny sender -> observer socket

Stage 2:
  generated hook script -> session-local sidecar/socket/named-pipe sender -> observer socket
```

Stage 1 is acceptable if it removes `apps/hook-runner`, `packages/hook-bridge`, config loading, provider adapter lookup, and hook command parsing from every event. Stage 2 is the lower-latency endpoint if Codex keeps command hooks as its only event surface.

### Required Removals

Delete or collapse these once the replacement path is installed:

```text
bin/wosm-hook
apps/hook-runner/
packages/hook-bridge/
apps/cli/src/commands/hook.ts
apps/cli/src/hookReceiver.ts
root package.json bin entry for wosm-hook
apps/hook-runner package/workspace references
hook-bridge package/workspace references
hook-runner and hook-bridge tests
generated hook docs that name wosm-hook as the normal path
```

Move or rewrite surviving responsibilities:

```text
resolveObserverPaths
  -> package that already owns config/path resolution, or a small existing utility surface

provider raw-event to HarnessEventReport mapping
  -> provider integration packages

offline compact spool record writer
  -> existing package or observer-owned helper, not a standalone old hook bridge package

hook install/doctor logic
  -> provider integration + CLI setup command, without a runtime hook delivery dependency on CLI
```

### Tests

Add or rewrite focused tests before deleting the old path:

```text
Pi extension emits a harness report without spawning wosm-hook
Codex generated hook script does not contain wosm-hook
Worktrunk generated hooks do not contain wosm-hook
offline sender writes a compact spool record
online sender reaches observer.harnessEvent.report
malformed provider payloads fail before observer delivery or spool writes
rg test proves no production generated hook path invokes wosm-hook
```

Update real/smoke docs and tests that currently assert `bin/wosm-hook`.

### Phase 1 Acceptance

```text
No generated provider hook calls wosm-hook.
Pi high-frequency events do not spawn a child process per event.
Codex generated hooks bypass apps/cli, apps/hook-runner, and packages/hook-bridge.
Worktrunk no longer keeps wosm-hook alive as a compatibility dependency.
apps/hook-runner is deleted.
packages/hook-bridge is deleted, renamed in-place with old concepts removed, or fully collapsed into existing packages.
The root package no longer exposes a wosm-hook bin.
Offline compact spool still works.
```

## Phase 2 - Fix Observer Ingress Backpressure

### Scope

Change observer handling from synchronous report processing to fast enqueue plus asynchronous semantic state processing.

This phase is required because direct protocol calls to the live observer were still slow under Pi load.

### Implementation Direction

1. Add an observer-owned harness ingress queue.
2. Change the protocol handler so `observer.harnessEvent.report` validates and enqueues, then returns an accepted/enqueued receipt.
3. Process queued reports in a worker using Effect Queue/Stream or the repo runtime equivalent.
4. Coalesce reports by stable agent key, session, worktree, turn, and tool where possible.
5. Update semantic agent state in memory and, if needed, in a current-state SQLite table.
6. Publish focused events for state changes.
7. Persist selected durable facts after enqueue, not before ack.
8. Schedule validation reconcile by coalesced reason, not once per accepted tool event.
9. Drain offline spool records into the same queue with bounded concurrency/rate.
10. Expose queue depth, dropped/coalesced counts, last error, and last drain stats in observer health/diagnostics.

### Persistence Policy

Do not persist every raw event as a provider observation by default.

Persist:

- session starts/stops,
- permission waits,
- agent state transitions,
- final status transitions,
- compact diagnostic facts needed for traceability,
- enough event identity to dedupe and debug.

Coalesce or keep in memory:

- repeated `working` status pings,
- high-frequency token/message deltas,
- tool progress events that do not change visible state,
- redundant events superseded by a newer report for the same agent key.

If durable dedupe is needed, use an indexed lookup or unique key, not a scan over historical event rows.

### Reconcile Policy

Reconcile remains the graph validator. It should not be the normal hook ack path.

Rules:

- A hook report may request reconcile.
- A hook report should not wait for reconcile.
- Multiple hook reports should collapse into one scheduled validation reconcile.
- Pure status reports should update semantic agent state immediately.
- Full reconcile should read the latest semantic state rather than replay all hook observations.

### Required Removals

Remove or rewrite observer code that exists only for the old inline path:

```text
observer reportHarnessEvent inline persistence before ack
observer reportHarnessEvent inline status projection before ack
per-event full provider observation writes for high-frequency harness status
ProviderHookEvent compatibility path once Worktrunk and harness hooks no longer need it
observer.ingestHookEvent protocol method if no remaining provider uses it
hook spool drain path that bypasses the new queue
```

### Tests

Red-first tests should prove the backpressure fix:

```text
observer.harnessEvent.report returns quickly when persistence is artificially slow
observer.harnessEvent.report returns quickly when reconcile is artificially slow
1000 Pi-like reports do not produce protocol timeouts
1000 Pi-like reports produce bounded queue depth through coalescing
semantic state changes publish focused events before full reconcile completes
reconcile scheduler receives batched reasons, not one full reconcile per report
spool drain enqueues records and does not block observer startup for the full drain
diagnostics expose queue depth, coalesced count, dropped count, and last error
snapshot consumes semantic agent state without parsing provider-specific payloads
```

### Phase 2 Acceptance

```text
Direct reportHarnessEvent to a live observer stays comfortably below hook timeout under Pi-like load.
Observer ack latency is independent from full reconcile latency.
Queue metrics are visible in observer health or diagnostics.
The TUI sees semantic status updates without waiting for a full provider scan.
Spool depth returns to zero after observer recovery without creating a reconcile storm.
No observer core code imports provider-specific payload types.
```

## Migration Order

Recommended order:

1. Add characterization tests for current `wosm-hook` and observer backpressure behavior.
2. Introduce the new sender path for one provider behind tests.
3. Convert Pi first because it is the high-frequency load source and can avoid child-process spawn entirely.
4. Convert Codex generated hooks next.
5. Convert Worktrunk lifecycle hooks so `wosm-hook` can actually be deleted.
6. Delete `apps/hook-runner` and collapse/delete `packages/hook-bridge`.
7. Change observer report handling to enqueue-first.
8. Add queue/coalescing diagnostics and load tests.
9. Update smoke, release-readiness, diagnostics, and dogfood docs.

If implementation risk forces the order to change, keep the same acceptance rule: no phase is complete while the old path remains as a normal production route.

## Open Questions

1. Should the tiny sender be a renamed replacement for `@wosm/hook-bridge`, or should surviving helpers move into existing packages with no new workspace package?
2. Should `observer.harnessEvent.report` keep the same receipt shape with `status: "accepted"` meaning "enqueued", or should contracts add an explicit `enqueued` status?
3. What is the smallest durable semantic agent state table that gives restart recovery without persisting every high-frequency event?
4. Can Codex command hooks use a session sidecar reliably, or should Stage 1 keep a tiny short-lived sender until Codex exposes a richer event transport?
5. Do Worktrunk lifecycle events belong in the same generic ingress method, or should they become a separate low-frequency provider event method that still bypasses CLI?

## Non-Goals

- Do not make the observer parse raw Codex, Pi, Claude, or OpenCode payloads.
- Do not make the TUI derive truth from provider payloads.
- Do not remove reconcile; make it asynchronous validation instead of hook ack work.
- Do not turn spool into the primary queue.
- Do not add a parallel package boundary unless another old boundary is removed in the same slice.
