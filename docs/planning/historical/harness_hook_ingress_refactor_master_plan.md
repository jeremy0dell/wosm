# Harness Hook Ingress Refactor Master Plan

- **Document status:** Superseded for future transport/backpressure work by `docs/planning/completed/harness_socket_ingress_and_observer_queue_plan.md`
- **Date:** 2026-05-24
- **Product area:** observer, harness integrations, hook delivery, status projection
- **Audience:** implementers, future agents, reviewers

This document is the source-of-truth plan for refactoring wosm hook ingestion from a
Codex-specific, CLI-shaped delivery path into a provider-neutral, low-latency harness
event pipeline.

The goal is not to remove the observer, replace the TUI, or rewrite provider
discovery. The goal is to make hook-producing harnesses report semantic status into
wosm quickly and durably without forcing every hook event through synchronous full
reconciliation.

---

## 1. Executive Summary

Today, a hook-producing harness can cause this runtime shape:

```text
Codex hook
  -> generated shell script
  -> wosm hook codex <event>
  -> apps/cli hook command
  -> hookReceiver
  -> observer socket
  -> observer hook ingestion
  -> provider hook normalization
  -> full reconcile inline
  -> reply to hook caller
```

That path is too heavy for a high-frequency hook surface. A `PreToolUse` or
`PostToolUse` event should be a fast status report, not a request to scan all
worktrees, tmux panes, harness runs, persisted observations, and graph state before
returning to the harness.

Target runtime shape:

```text
hook-producing harness
  -> tiny provider bridge
  -> observer local socket fast ingest
  -> compact durable event/observation
  -> live status projection update
  -> async debounced reconcile
  -> WosmSnapshot publication
```

Hooks should report semantic facts. Reconcile should validate and rebuild the graph.
The two must be connected, but they must not be the same synchronous operation.

---

## 2. Definitions

### Hook-Producing Harness

A harness that can emit lifecycle, tool, permission, or session events while an agent
is running.

Examples:

```text
Codex
Claude Code
OpenCode
Pi
future local agent harnesses
```

### Hook Bridge

The executable or plugin code invoked by the harness. For command-hook systems, this
must be a process. For plugin systems, it may be in-process plugin code.

The bridge should:

- read the provider event;
- attach stable wosm correlation context when available;
- send a compact report to the observer local socket;
- spool on failure;
- exit quickly.

The bridge should not:

- run full observer reconcile;
- discover worktrees;
- inspect tmux;
- classify all harness runs;
- write unbounded raw tool payloads to logs;
- block waiting for the TUI snapshot to rebuild.

### Observer Ingress

The observer API path that accepts external provider events. It should be fast,
durable, and bounded.

### Status Projection

The observer-owned current semantic state derived from recent harness events and
live provider observations. This is the layer that lets a row flip from `unknown` to
`working`, `idle`, or `needs_attention` before the next full reconcile completes.

### Reconcile

The slower observer operation that reads all configured providers and rebuilds the
provider-neutral graph.

Reconcile remains the validator and graph builder. It should be scheduled by hooks,
not awaited by hooks.

### Spool

A local durable fallback queue used when the observer cannot accept an event over the
socket quickly enough.

Spool is a fallback. A healthy system should usually have spool depth `0`.

---

## 3. Current Runtime Evidence

The current implementation has useful pieces, but their composition creates
backpressure.

Important current code paths:

```text
integrations/harness/codex/src/hooks.ts
  generates a shell hook script that calls `wosm hook codex <event>`

apps/cli/src/main.ts
  routes `wosm hook ...` into runHookCommand()

apps/cli/src/commands/hook.ts
  parses stdin JSON and attaches Codex wosm context from env

apps/cli/src/hookReceiver.ts
  tries observer delivery, auto-start, then spools

apps/observer/src/runtime/api.ts
  exposes ingestHookEvent()

apps/observer/src/hooks/ingestion.ts
  persists hook.ingested, dispatches provider hook ingest, then may call reconcile

apps/observer/src/reconcile/core.ts
  serializes reconcile calls with reconcileChain

apps/observer/src/reconcile/run.ts
  performs full provider reads and graph persistence

apps/observer/src/hooks/spool.ts
  drains persisted hook files
```

Specific pressure points:

- Hook delivery timeout is short, around hundreds of milliseconds.
- Observer hook ingestion can await `reconcile("hook:provider:event")`.
- Reconcile is serialized. Multiple hook-triggered reconciles queue behind each other.
- Reconcile performs full provider work.
- Reconcile currently drains spool before running, so a reconcile can inherit old hook
  backlog work.
- Hook logs can include raw hook payloads, including large tool input/output.
- Spool files can also carry full raw payloads.

This explains why a hook queue can appear to take seconds. The queue is not just
tiny hook records. It is coupled to full graph rebuilds.

---

## 4. External Reference Pattern

Herdr is the most directly relevant public reference found so far:

- It runs a long-lived local server with a Unix socket API.
- It uses process detection for pane identity and liveness.
- It uses hooks/plugins only for semantic state reports.
- Its `pane.report_agent` socket method accepts state such as `working`, `blocked`,
  and `idle`.
- Its Codex and OpenCode integrations send compact reports directly to the socket
  with short timeouts and ignore failures.

Reference links:

- https://github.com/ogulcancelik/herdr/
- https://raw.githubusercontent.com/ogulcancelik/herdr/master/INTEGRATIONS.md
- https://raw.githubusercontent.com/ogulcancelik/herdr/master/SOCKET_API.md
- https://raw.githubusercontent.com/ogulcancelik/herdr/master/src/integration/assets/codex/herdr-agent-state.sh
- https://raw.githubusercontent.com/ogulcancelik/herdr/master/src/integration/assets/opencode/herdr-agent-state.js

The lesson for wosm is not to copy Herdr's pane model. The lesson is:

```text
process/terminal discovery owns identity and liveness
hooks/plugins enrich semantic status over a fast local socket
heavy reconciliation does not sit on the hook critical path
```

---

## 5. Target Architecture

### 5.1 High-Level Shape

```text
Codex / Claude / OpenCode / Pi / future harness
        |
        v
provider-specific hook or plugin
        |
        v
tiny wosm hook bridge
        |
        v
observer local socket fast ingest
        |
        +--> durable compact event/observation
        +--> live status projection
        +--> async reconcile scheduler
        |
        v
observer graph / WosmSnapshot
        |
        v
TUI
```

### 5.2 Source-of-Truth Model

The existing provider-neutral ownership model stays intact:

```text
Config owns configured projects.
Worktree providers own worktree facts.
Terminal providers own terminal identity and liveness facts.
Harness providers own harness-specific launch/discovery/event normalization.
Observer owns correlation, status projection, persistence, and snapshots.
TUI owns presentation only.
```

Hooks must not become the sole source of truth for identity or liveness.

Correct authority split:

```text
terminal/process discovery:
  pane exists
  process exists
  target identity
  terminal provider facts

worktree provider:
  worktree exists
  worktree metadata

harness hooks:
  semantic state hints
  status transitions
  permissions or attention signals
  provider event timing

observer:
  correlation
  confidence
  stale handling
  snapshot shape
```

### 5.3 Package Shape

Near-term shape:

```text
apps/cli
  keeps `wosm hook <provider> <event>`
  hookReceiver becomes a true fast transport shim

apps/observer
  owns fast ingest, status projection, reconcile scheduler, spool drain

integrations/harness/*
  own provider-specific hook install and raw event normalization

packages/contracts
  owns provider-neutral report schemas

packages/protocol
  owns observer socket methods
```

Long-term optional shape:

```text
apps/hook-runner
  provides `wosm-hook <provider> <event>` or provider-specific binaries

packages/hook-bridge
  shared tiny transport/spool implementation
```

The optional split is packaging cleanup. It is not the first bug fix.

---

## 6. Target Contracts

The exact names can change during implementation, but the architecture needs a
provider-neutral report shape.

Candidate compact report:

```ts
type HarnessEventReport = {
  schemaVersion: string;
  reportId: string;
  provider: string;
  eventType: string;
  observedAt: string;
  kind: "harness";
  status?: {
    value: "working" | "idle" | "needs_attention" | "unknown";
    confidence: "low" | "medium" | "high";
    source: "harness_hook" | "harness_plugin";
    reason?: string;
  };
  correlation?: {
    harnessRunId?: string;
    sessionId?: string;
    worktreeId?: string;
    terminalTargetId?: string;
    projectId?: string;
    cwd?: string;
    pid?: number;
  };
  diagnostics?: {
    payloadBytes?: number;
    rawEventType?: string;
    truncated?: boolean;
  };
};
```

Construction rule: preserve `exactOptionalPropertyTypes`. Use typed local builders
with explicit `if` assignments for complex mappers.

### 6.1 Protocol Method

Candidate method:

```text
observer.harnessEvent.report
```

Candidate receipt:

```ts
type HarnessEventReportReceipt = {
  schemaVersion: string;
  reportId: string;
  provider: string;
  eventType: string;
  accepted: boolean;
  status: "accepted" | "spooled" | "rejected";
  receivedAt: string;
  projected?: boolean;
  scheduledReconcile?: boolean;
  deduped?: boolean;
  error?: SafeError;
};
```

The receipt must not promise that full reconcile completed.

### 6.2 Compatibility With Existing ProviderHookEvent

The existing `ProviderHookEvent` can remain as a compatibility envelope during the
migration. The target is to avoid raw provider payloads becoming the main persisted
or logged object.

Migration-friendly route:

```text
raw provider hook payload
  -> provider integration normalization
  -> HarnessEventReport / HarnessEventObservation
  -> observer status projection
```

---

## 7. Fast Ingest Semantics

Fast ingest must do only bounded work:

```text
parse strict schema
dedupe report id
persist compact event/observation
update live status projection when correlation is strong enough
publish lightweight event
schedule reconcile
return receipt
```

Fast ingest must not:

```text
list worktrees
list tmux panes
discover all harness runs
classify all harness runs
drain unbounded spool backlog
write huge raw payloads
wait for graph rebuild
```

Target timing budgets:

```text
socket connect/send/receipt: 50-150ms common case
hook bridge hard timeout: <= 500ms
spool fallback write: <= 100ms common case
full reconcile: not on hook critical path
```

These budgets are targets, not strict public contracts. They should shape tests and
instrumentation.

---

## 8. Reconcile Scheduler

Hook events should request reconcile through a scheduler.

Required behavior:

- One reconcile runs at a time.
- Multiple hook events inside a short window coalesce into one reconcile.
- If a hook arrives while reconcile is running, mark a pending reconcile.
- After the current reconcile finishes, run at most one follow-up reconcile for the
  pending work.
- Manual `wosm reconcile` still runs immediately and returns a real receipt.
- TUI startup reconcile still works.

Candidate scheduler state:

```ts
type ReconcileScheduler = {
  request(reason: string, options?: { immediate?: boolean }): void;
  runNow(reason: string): Promise<ReconcileReceipt>;
  getStatus(): {
    running: boolean;
    pending: boolean;
    queuedReasons: string[];
    lastStartedAt?: string;
    lastFinishedAt?: string;
  };
};
```

Candidate algorithm:

```text
request(reason):
  record/coalesce reason
  if running:
    pending = true
    return
  if timer exists:
    return
  set timer for debounce window

timer fires:
  if running:
    pending = true
    return
  running = true
  reasons = drain queued reasons
  await core.reconcile(summaryReason(reasons))
  running = false
  if pending or new queued reasons:
    pending = false
    request("scheduled-follow-up")
```

Reason coalescing should be human-readable:

```text
hook:codex:PreToolUse + hook:codex:PostToolUse
  -> hook:codex:batch(2)
```

---

## 9. Status Projection

Status projection is the observer-owned fast path for row state.

The existing harness event status overlay work is the right direction:

```text
persisted harness_event observations
  + live harness runs
  -> correlated run status
  -> graph row state
```

The refactor extends that idea from "applied during reconcile" to "accepted during
ingest and visible through snapshot/event publication without blocking the hook."

Projection rules:

- Never create a worktree row from a hook alone.
- Never create a terminal target from a hook alone.
- Do not let stale hook events override newer high-confidence terminal/harness exits.
- Prefer exact `harnessRunId` correlation.
- Then allow unique `sessionId`.
- Then allow unique `worktreeId` only when unambiguous.
- If a hook has a mismatched `harnessRunId`, do not fall back to weaker keys.
- Preserve status provenance and status `updatedAt`.
- Keep live run last-seen timestamps based on provider observations, not hook status
  timestamps.

Projection output should preserve:

```text
status.value
status.confidence
status.reason
status.source
status.updatedAt
correlatedBy
rawEventType
```

---

## 10. Spool Design

Spool remains necessary because hook systems are fire-and-forget and the observer may
be down.

Target spool behavior:

```text
socket accepts quickly:
  no spool

socket unavailable or timed out:
  write compact report to spool
  return success-ish spooled receipt to harness

observer later:
  drain bounded batch
  ingest without triggering per-record full reconcile
  schedule one reconcile after batch
```

Required properties:

- Compact record shape.
- Strict schema.
- Atomic writes.
- Bounded batch drain.
- Retry metadata.
- Dead-letter or diagnostic handling for permanently invalid records.
- No unbounded raw tool payload.
- Doctor-visible depth and oldest record age.

Candidate limits:

```text
max compact report size: 64 KiB
default drain batch: 25 records
max drain time per pass: 250ms or 500ms
payload diagnostic retention: off or bounded
```

Exact values should be chosen with tests and local dogfood evidence.

---

## 11. Logging And Payload Policy

Current hook logging can include full payloads. That is risky for latency, disk, and
privacy.

Target logging:

```text
hooks.jsonl:
  hook/report id
  provider
  event type
  status
  timing
  payload byte count
  truncated flag
  correlation keys present
  error summary when present
```

Avoid by default:

```text
full tool_input
full tool_response
full terminal output
full prompt text
secrets or env dumps
large JSON blobs
```

Diagnostic bundles may include sampled/redacted payload details only when explicitly
requested and bounded by retention policy.

---

## 12. Phased Migration Plan

### Phase 0 - Baseline Evidence And Guardrails

Goal:

Document and test the current failure mode before changing architecture.

Build scope:

- Add hook ingress latency metrics or structured log fields.
- Add a test fixture for burst hook ingestion.
- Add current spool depth and oldest spool age to doctor/health if not already
  present.

Test pack:

- Unit test for hook receiver timeout fallback.
- Integration test showing burst hooks currently do not require one reconcile per
  hook after the refactor. This can be written red-first before scheduler exists.
- Integration test for bounded spool drain.

Acceptance criteria:

- We can see hook accept latency, reconcile queue wait, reconcile duration, and spool
  depth in logs or health.
- A burst test exists and fails against the current inline-reconcile behavior.

### Phase 1 - Decouple Hook Ingest From Full Reconcile

Goal:

Make observer hook ingestion return after durable ingest/projection work, not after
full reconcile.

Build scope:

- Change `createHookIngestion` so reconcile is not awaited inline for normal hook
  events.
- Add a scheduler in `apps/observer/src/runtime/api.ts` or a dedicated runtime module.
- Wire `ingestHookEvent` to schedule reconcile.
- Preserve manual `api.reconcile()` behavior.

Test pack:

- Hook ingest returns `reconciled: false` or `scheduledReconcile: true`.
- Hook ingest does not await a slow reconcile.
- Burst of hooks schedules one or two reconciles, not N reconciles.
- Manual reconcile still drains spool and returns snapshot.

Acceptance criteria:

- Hook delivery common path is bounded by parse/persist/provider event ingest only.
- Reconcile still happens soon after hook activity.
- TUI eventually updates from reconciled snapshots.

### Phase 2 - Compact Hook Logs And Spool Records

Goal:

Stop putting huge raw provider payloads on the hook critical path.

Build scope:

- Replace raw payload logging in `apps/cli/src/hookReceiver.ts` with compact metadata.
- Introduce bounded/truncated spool record payload or compact report spool format.
- Add payload byte counting and truncation flags.
- Preserve enough information to normalize status after replay.

Test pack:

- Large `PostToolUse` payload does not produce a huge hook log entry.
- Large payload spools as compact/truncated record or is summarized safely.
- Invalid compact spool record stays for diagnostics without blocking valid records.

Acceptance criteria:

- Hook log and spool size are bounded.
- Status-producing fields survive compaction.
- Sensitive/large provider content is not logged by default.

### Phase 3 - Provider-Neutral Harness Event Report

Goal:

Make the ingress contract explicitly provider-neutral.

Build scope:

- Add `HarnessEventReportSchema` or equivalent to contracts.
- Add protocol method for report ingest, or evolve `hook.ingest` carefully.
- Map existing `ProviderHookEvent` into the new report shape.
- Keep provider-specific parsing in `integrations/harness/*`.

Test pack:

- Schema tests for optional field absence versus `undefined`.
- Codex raw event normalizes to provider-neutral report.
- Scripted/fake harness report normalizes without Codex assumptions.
- Observer rejects invalid reports with typed safe errors.

Acceptance criteria:

- Observer fast path consumes provider-neutral reports.
- Codex-specific hook names do not leak into observer core decisions except as
  provider data or diagnostics.

### Phase 4 - Live Status Projection

Goal:

Let accepted hook reports update current semantic status without waiting for a full
provider scan.

Build scope:

- Persist compact status observations.
- Maintain in-memory or SQLite-backed latest status overlay.
- Apply overlay to current snapshot safely.
- Publish an event that the TUI can use to refresh or receive a new snapshot.

Test pack:

- A matching hook report updates `working`.
- Permission/blocked report updates `needs_attention`.
- Stop/idle report updates `idle`.
- Unknown status does not clobber useful live state.
- Ambiguous reports are diagnostic-only.
- High-confidence exited state is not overwritten by older hook activity.

Acceptance criteria:

- TUI rows can move from `?` to `*`, `.`, or `!` based on hooks.
- The next reconcile validates and persists the same semantics.
- Provenance survives into session state.

### Phase 5 - Hook Bridge Packaging

Goal:

Make the hook-side executable a deliberately small bridge.

Build scope options:

Near-term:

```text
Keep `wosm hook <provider> <event>`.
Remove heavy behavior from that path.
```

Long-term:

```text
Add `apps/hook-runner` or `packages/hook-bridge`.
Install provider hooks that call `wosm-hook`.
Keep `wosm hook` as compatibility wrapper.
```

Test pack:

- Installed Codex hook command points to the expected bridge.
- Bridge exits successfully when observer accepts.
- Bridge spools when observer is unavailable.
- Bridge does not import TUI or observer core code.

Acceptance criteria:

- Hook command is visibly separate from user/admin CLI flows.
- Startup/config work in the hook path is minimal.
- Existing installations can migrate without breaking active users.

### Phase 6 - Multi-Harness Rollout

Goal:

Apply the same ingress model across hook-producing harnesses.

Build scope:

- Codex first, because it already exposes the bug.
- Add or adapt Claude/OpenCode/Pi integrations when available.
- Keep each provider's event semantics behind its integration.

Provider mapping examples:

```text
Codex:
  UserPromptSubmit -> working
  PreToolUse -> working
  PostToolUse -> working
  PermissionRequest -> needs_attention
  Stop -> idle

Claude:
  UserPromptSubmit -> working
  PreToolUse -> working
  PermissionRequest -> needs_attention
  Stop -> idle
  SessionEnd -> release or exited-like diagnostic

OpenCode:
  permission.asked -> needs_attention
  permission.replied allow -> working
  permission.replied reject -> idle or needs_attention depending provider semantics
  session.status busy/retry -> working
  session.status idle -> idle
```

Mappings must be verified against each provider's actual current hook/plugin API
before implementation.

Test pack:

- Shared harness report contract tests.
- Provider-specific mapping tests.
- Observer integration tests that use fake providers rather than real CLIs.
- Real dogfood tests remain opt-in.

Acceptance criteria:

- Observer core stays provider-neutral.
- TUI tests do not mock Codex, tmux, or hook internals.
- Adding a new hook-producing harness is mostly an integration-layer change.

### Phase 7 - Diagnostics, Doctor, And Operations

Goal:

Make hook backpressure visible and actionable.

Build scope:

- Health fields:
  - hook accept latency recent p50/p95 if available;
  - scheduled reconcile queue status;
  - spool depth;
  - oldest spool age;
  - last drain result;
  - last hook ingest error.
- `wosm doctor` checks:
  - hook bridge installed;
  - observer socket reachable;
  - spool backlog present;
  - observer build is stale compared to current workspace build, when detectable.
- Debug bundle:
  - compact hook logs;
  - spool summary;
  - reconcile timing.

Acceptance criteria:

- A user can tell whether hooks are being accepted, spooled, drained, or rejected.
- A user can tell whether reconcile is backlogged.
- Diagnostic output does not require reading raw SQLite by hand.

### Phase 8 - Cleanup And Compatibility Removal

Goal:

Remove legacy coupling after the new path is stable.

Build scope:

- Remove inline hook-triggered full reconcile paths.
- Remove raw payload logging from hook path permanently.
- Remove compatibility wrappers only after migration window.
- Update docs and known issues.

Acceptance criteria:

- No production hook path awaits full reconcile.
- No provider-specific hook semantics live in observer core.
- Spool is rare during dogfood.

---

## 13. Migration Strategy Options

### Option A - Minimal Surgical Fix

```text
decouple ingest from reconcile
add scheduler
trim logs
```

Pros:

- Fastest.
- Directly addresses timeout/spool storm.
- Low package churn.

Cons:

- Keeps `apps/cli` as the hook bridge for now.
- Does not fully clarify provider-neutral report contracts.

Recommended as first implementation slice.

### Option B - Proper Medium Migration

```text
Option A
+ provider-neutral report schema
+ compact spool format
+ status projection
+ hook bridge package/app
```

Pros:

- Aligns with long-term architecture.
- Makes future harnesses cleaner.
- Better diagnostics and performance posture.

Cons:

- More tests and migration surface.

Recommended overall target.

### Option C - Big Bang Rewrite

```text
new hook runner
new contracts
new protocol
new observer projection
new provider integrations
all at once
```

Not recommended.

The system already has useful provider boundaries, persistence, protocol, and tests.
The safer path is to decouple the critical path first, then cleanly migrate the
contract and packaging.

---

## 14. Test Strategy

Required unit tests:

- Schema parse/reject for compact reports.
- Provider-specific event mapping.
- Hook bridge compact payload construction.
- Scheduler coalescing behavior.
- Status projection correlation rules.
- Spool batch ordering and failure behavior.

Required integration tests:

- Hook ingest returns without waiting for slow reconcile.
- Burst hooks schedule bounded reconciles.
- Spool drain ingests a batch and schedules one reconcile.
- Live status projection changes snapshot row state.
- Unknown/ambiguous/unmatched hook events remain diagnostic-only.
- Manual reconcile still behaves synchronously.

Required TUI tests:

- TUI renders provider-neutral snapshot states only:
  - `working -> *`
  - `idle -> .`
  - `needs_attention -> !`
  - `unknown -> ?`
- TUI tests should not know Codex hook names.

Opt-in real tests:

- Real Codex hook activity drives `working`.
- Real permission/attention event drives `needs_attention` when available.
- Real Stop drives `idle`.
- Spool depth returns to zero after observer restart.

Performance tests:

- 50 hook reports do not trigger 50 full reconciles.
- Large provider payload does not create large hook log entries.
- Hook accept latency stays under budget with a slow reconcile in progress.

---

## 15. Acceptance Criteria For The Full Refactor

Functional:

- Hook-producing harnesses can report status through one provider-neutral ingress
  model.
- Hooks can update live row status without waiting for a full reconcile.
- Reconcile still validates and persists graph state.
- Terminal/process discovery remains the liveness authority.

Reliability:

- Hook delivery does not routinely time out under normal local dogfood.
- Spool is a fallback, not steady-state behavior.
- Spool drains in bounded batches and converges to zero when observer is healthy.
- Slow provider discovery does not block hook acceptance.

Performance:

- Hook bridge common path exits in under 500ms.
- Hook accept path does not run provider discovery.
- Burst hooks coalesce into bounded reconcile work.
- Hook log and spool records are size-bounded.

Architecture:

- Observer core consumes provider-neutral reports/observations.
- Provider-specific hook semantics stay in `integrations/harness/*`.
- TUI renders `WosmSnapshot` only.
- Public contracts are strict schemas.

Diagnostics:

- Doctor and debug bundle expose hook backlog and reconcile backpressure.
- Logs contain enough metadata to debug without dumping raw tool output by default.

---

## 16. Open Decisions

These should be decided during implementation, not left implicit.

1. Should the new protocol method be `observer.harnessEvent.report` or an evolution
   of existing `hook.ingest`?
2. Should the first implementation keep `ProviderHookEvent` as the wire envelope and
   add compact report payloads inside it, or introduce a new contract immediately?
3. Should live status projection be in-memory with SQLite persistence, or derived
   from SQLite on each snapshot request?
4. What are the exact payload size limits for logs and spool records?
5. What is the default scheduler debounce window?
6. Should spool drain happen on a timer, on startup, on scheduled reconcile, or all
   three with strict budgets?
7. Should hook bridge packaging become `apps/hook-runner` immediately, or should
   `apps/cli` host the fixed path first?

Recommended defaults:

```text
protocol:
  add explicit provider-neutral report method when ready

first fix:
  keep apps/cli command, remove heavy behavior

projection:
  persist compact observations and keep an in-memory latest projection

debounce:
  start with 100-250ms

spool drain:
  startup + scheduled bounded batches

payload:
  compact metadata by default, raw payload only in bounded diagnostics
```

---

## 17. Implementation Notes For Agents

- Read `docs/architecture.md` before boundary decisions.
- Read `docs/development.md` before implementing scoped development slices.
- Use the old rebuild TDD and phased plan only for historical rationale or explicit
  phase archaeology.
- Preserve provider neutrality.
- Do not import Codex, tmux, Worktrunk, or provider-specific code into observer core.
- Use strict schemas for any hook/report/spool wire format.
- Preserve `exactOptionalPropertyTypes`.
- Use typed local builders for complex optional objects.
- Do not use `...(await somePromise)` in production object or array construction.
- Do not make TUI tests aware of provider internals.
- Add tests before implementation for each phase.

---

## 18. Suggested First Slice

The first implementation slice should be small and high impact:

```text
1. Add a reconcile scheduler.
2. Change hook ingestion to schedule reconcile instead of awaiting reconcile.
3. Ensure spool drain calls hook ingest with `triggerReconcile: false`.
4. Schedule one reconcile after a spool drain batch.
5. Trim hook logs so they do not include raw payload by default.
6. Add burst tests.
```

This first slice should leave the external installed Codex hook command alone:

```text
wosm hook codex <event>
```

That avoids install/migration churn while fixing the actual backpressure bug. After
that is stable, move to provider-neutral report contracts and optional hook-runner
packaging.
