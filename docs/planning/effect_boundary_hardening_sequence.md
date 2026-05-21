# Effect Boundary Hardening Sequence

**Status:** Planning addendum  
**Date:** 2026-05-21  
**Applies to:** current implementation after the initial runtime, observer, protocol, CLI, diagnostics, and Worktrunk slices  
**Source baseline:** `docs/planning/wosm_rebuild_tdd_final_v1.md` section 3.7 and section 19.10

This document sequences the follow-up hardening work found by auditing the current code against the Effect boundary decision rubric.

The goal is not to convert the codebase to Effect. The goal is to move timeout, retry, cancellation, cleanup, queueing, typed error conversion, and diagnostic context into deliberate runtime boundaries, while keeping pure code plain.

## 1. Boundary Rule

Every item in this sequence must start red-first:

```text
write the named tests
run the tests and observe the expected failure
implement the boundary change
make the tests pass
keep the rest of main green
```

For each changed boundary, explicitly choose one posture:

```text
Effect-native internals with Promise/AsyncIterable facade
Effect-native internals and Effect-native public API for internal consumers
plain TypeScript or Promise code because the boundary is simpler that way
```

Plain TypeScript is correct for pure transforms, schemas, fixtures, contracts, static registries, simple row mapping, and presentation components. It is not correct when the code is quietly recreating one-off retry, timeout, cancellation, cleanup, queueing, subscription, or typed-error plumbing.

## 2. Recommended Sequence

### Step 1 - Runtime Boundary Primitives

Own this before changing higher-level callers.

Primary files:

```text
packages/runtime/src/boundary.ts
packages/runtime/src/shutdown.ts
packages/runtime/src/externalCommand.ts
packages/runtime/src/effect.ts
packages/runtime/test/unit/runtime-boundary.test.ts
packages/runtime/test/unit/runtime-retry-timeout-cancellation.test.ts
packages/runtime/test/unit/external-command.test.ts
```

Red tests:

```text
timeout interrupts or aborts the underlying work instead of only rejecting the wrapper
cancellation triggers task cleanup and does not leave work running
retry delay is interruptible
external command is killed or aborted on timeout/cancel
runtime boundary preserves traceId, spanId, and operation on success and failure
Promise facades still expose simple results for non-Effect consumers
```

Implementation direction:

Use Effect-native internals for timeout, retry, cancellation/interruption, resource cleanup, and external command execution. Keep Promise facades for existing callers.

Add an abort/cancellation bridge for Node APIs. `ExternalCommandInput` should support cancellation through a signal or equivalent managed runtime context. Runtime should own typed timeout/cancellation/external-command conversion before observer, CLI, protocol, or providers depend on it.

Acceptance:

```text
no shared runtime timeout helper uses Promise.race as the core cancellation mechanism
retry behavior is implemented through the shared runtime layer
external commands can be aborted and produce typed safe errors
runtime tests prove cleanup, interruption, typed errors, and trace/span propagation
```

### Step 2 - Protocol IO Boundaries

Primary files:

```text
packages/protocol/src/client.ts
packages/protocol/src/server.ts
packages/protocol/src/transport.ts
packages/protocol/src/messages.ts
packages/protocol/test/integration/client-server.test.ts
packages/protocol/test/integration/event-subscription.test.ts
packages/protocol/test/unit/transport.test.ts
```

Red tests:

```text
connected socket with no response times out with a typed ProtocolError or TimeoutError
subscribe ack hang times out and closes the socket
subscription close interrupts server-side iterator
server handler timeout maps to a safe protocol error
known SafeError categories are preserved across protocol responses
invalid protocol frames remain safe and do not leak raw stacks
```

Implementation direction:

Prefer Effect-native protocol internals with the current Promise/AsyncIterable facade preserved. Apply deadlines after connection, not only during socket connect. Tie subscriptions to explicit cleanup so long-lived iterators are interrupted when clients disconnect.

Acceptance:

```text
client request timeout covers connect, send, response wait, and subscription ack
server request handling has bounded execution or a documented reason when unbounded
subscription cleanup is deterministic and tested
protocol errors remain SafeError-compatible and specific
```

### Step 3 - Observer Command Queue And Shutdown

Primary files:

```text
apps/observer/src/commandQueue.ts
apps/observer/src/api.ts
apps/observer/src/main.ts
apps/observer/src/server.ts
apps/observer/test/integration/command-queue.test.ts
tests/e2e/observer-lifecycle.test.ts
```

Red tests:

```text
hung command times out and persists a typed failure
shutdown interrupts an in-flight command
cancelled command records a CancellationError or specific cancellation safe error
command.failed event is emitted before SQLite closes
per-worktree/session serialization still holds
drain does not wait forever on cancelled work
observer stop and SIGTERM share the same cleanup behavior
```

Implementation direction:

This is a strong Effect candidate because queueing, concurrency, cancellation, scoped cleanup, typed errors, event emission, logs, and persistence overlap. Use Effect queue/fiber/scope primitives or document a narrow local Promise mutex/queue if it is simpler and fully tested.

Acceptance:

```text
command execution has a clear lifecycle: accepted, started, succeeded/failed/cancelled
in-flight command work is interruptible
shutdown is idempotent
SQLite closes after command cancellation/failure records are flushed
```

### Step 4 - Reconcile Single-Flight And Provider Boundaries

Primary files:

```text
apps/observer/src/reconcile.ts
apps/observer/src/api.ts
apps/observer/src/providerRegistry.ts
apps/observer/test/integration/reconcile-fake-providers.test.ts
apps/observer/test/integration/reconcile-persistence.test.ts
packages/testing/src/index.ts
```

Red tests:

```text
hung worktree provider health/list call times out and records provider health failure
hung terminal provider list call times out and records provider health failure
hung harness discover call times out and records provider health failure
transient health/list failure retries only when the operation is safe
retry attempts are visible in logs, diagnostics, or provider health context
concurrent reconciles do not interleave mutable snapshot/providerHealth/lastReconcile state
spool draining and reconcile cannot recursively corrupt observer state
```

Implementation direction:

Add single-flight or semaphore behavior around reconcile. Apply provider call timeout policy at the observer/provider boundary. Retry safe read operations such as health/list/discover only when idempotency is clear. Do not blindly retry mutating operations.

Acceptance:

```text
one reconcile mutates observer state at a time
provider hangs degrade provider health instead of hanging observer
retry policy is explicit by operation type
provider errors retain trace/span/log context
```

### Step 5 - External Command And Worktrunk Provider Hardening

Primary files:

```text
integrations/worktree/worktrunk/src/provider.ts
integrations/worktree/worktrunk/src/errors.ts
integrations/worktree/worktrunk/src/hooks.ts
integrations/worktree/worktrunk/test/unit/provider.test.ts
integrations/worktree/worktrunk/test/unit/hooks.test.ts
tests/support/fake-external-tools/worktrunk.ts
packages/runtime/src/externalCommand.ts
```

Red tests:

```text
Worktrunk health/list/create/remove timeout maps to typed timeout/provider error
Worktrunk subprocess is aborted on timeout/cancel
invalid create/switch output maps to WorktrunkProviderError, not raw SyntaxError
create succeeds but parse/list fails: cleanup is attempted or a diagnostic recovery record is emitted
safe read operations retry transient failures
create/remove do not retry unless idempotency is explicitly proven
hook config ENOENT is distinct from unreadable config or invalid TOML
hook install backup/write failures map to typed Worktrunk hook setup errors
```

Implementation direction:

Route subprocess execution through the hardened runtime external command boundary. Make Worktrunk timeout a typed boundary outcome, not an incidental `execFile` error. Keep Worktrunk-specific details inside the provider; observer should see normalized provider errors and SafeError-compatible records.

Acceptance:

```text
Worktrunk provider never leaks raw parser or fs errors across provider boundary
timeout/cancel/retry policy is explicit per operation
fake runners can script success, transient failure, hang, abort observation, and cleanup assertions
```

### Step 6 - CLI Doctor, Debug Bundle, Hook Receiver, And Hook Spool

Primary files:

```text
apps/cli/src/commands/doctor.ts
apps/cli/src/commands/debugBundle.ts
apps/cli/src/hookReceiver.ts
apps/cli/src/hookSpool.ts
apps/cli/src/observerProcess.ts
apps/cli/test/integration/diagnostic-commands.test.ts
apps/cli/test/integration/hook-command.test.ts
apps/cli/test/unit/hook-receiver.test.ts
apps/cli/test/unit/observer-process.test.ts
```

Red tests:

```text
doctor RPC timeout maps to typed safe error
debug bundle diagnostic collection timeout maps to typed safe error
debug bundle write failure maps to typed safe error
hook delivery timeout aborts original delivery before retry/spool
timed-out hook delivery cannot double-ingest the same event
hook spool write/read/chmod/schema failures map to typed hook errors
observer startup polling uses shared retry/timeout policy
```

Implementation direction:

Wrap the full CLI command flow, not only observer startup. Use separate boundaries for startup, RPC, bundle filesystem writes, and hook spool persistence. Preserve simple command APIs for callers.

Acceptance:

```text
CLI boundary failures are SafeError-compatible
hook receiver cannot duplicate delivery after a timeout
filesystem boundary failures are typed and diagnosable
startup polling does not maintain local timeout/retry loops outside runtime helpers
```

### Step 7 - Boundary Inventory Guard

Primary files:

```text
tests/contract-fixtures or tests/support boundary inventory fixture
tests/diagnostics or tests/unit boundary-inventory test
```

Red tests:

```text
production boundary modules do not use raw Promise.race for timeout/cancel behavior outside @wosm/runtime
production boundary modules do not implement hand-rolled retry loops outside @wosm/runtime
production boundary modules do not add ad hoc setTimeout polling without an explicit allowlist entry
allowlisted plain TypeScript boundaries include a reason
```

Implementation direction:

Keep this lightweight. It should prevent regressions without banning plain TypeScript. The allowlist should be explicit and reviewed when a boundary intentionally stays plain.

Acceptance:

```text
new ad hoc boundary plumbing fails fast in tests
allowlisted plain Promise code is documented
pure code is not forced into Effect
```

### Step 8 - TUI Service Boundary When TUI Work Starts

Primary files:

```text
apps/tui/src/services/observerClient.ts
apps/tui/src/hooks/*
apps/tui/src/components/*
apps/tui/test/*
```

Red tests:

```text
initial snapshot timeout maps to UI-safe error state
subscription cancellation runs on unmount
command dispatch maps protocol SafeError to toast/view model state
retry policy is in service layer, not components
React/Ink components receive plain props/state
TUI service does not import providers or parse raw provider payloads
```

Implementation direction:

Use Effect only in TUI service hooks and protocol IO orchestration when it improves cancellation, retry, cleanup, and error mapping. Keep presentation components plain.

Acceptance:

```text
TUI owns UX state only
observer protocol IO is isolated in service boundaries
no provider mechanics leak into components
```

## 3. Explicit Non-Goals

Do not use this hardening sequence to convert the whole repo to Effect.

Keep these plain unless a later phase introduces a real runtime boundary:

```text
contracts
schemas
fixtures
static config defaults
pure config normalization
provider registry data structures
snapshot grouping and selectors
React/Ink presentation components
simple test helpers
SQLite row mapping
```

SQLite transactions may stay mostly synchronous and plain because `node:sqlite` is synchronous in this design. The boundary should still attach typed errors and trace/log context at higher-level persistence operations.

## 4. Suggested PR Order

```text
1. Runtime boundary primitives and tests.
2. Protocol request/subscription deadlines and cleanup.
3. Observer command queue cancellation and shutdown.
4. Reconcile single-flight and provider timeout/retry policy.
5. External command and Worktrunk typed timeout/cancel behavior.
6. CLI diagnostics, hook receiver, and hook spool boundaries.
7. Boundary inventory guard.
8. TUI observer service boundary when TUI implementation begins.
```

This order matters. Do not refactor observer, protocol, CLI, or providers onto new boundary semantics before `@wosm/runtime` can actually interrupt, cancel, retry, clean up, and preserve diagnostic context.

## 5. Phase Relationship

This sequence is a refinement of Phase 6 and a prerequisite hardening track before real provider work is considered complete.

```text
Phase 6 owns the runtime boundary primitives and diagnostic foundation.
Phase 7 Worktrunk work should not be considered complete until Step 5 is satisfied.
Protocol, observer, and CLI steps can be done after Phase 6 but before relying on real long-lived provider or TUI behavior.
TUI service boundary work belongs with the TUI phase, but should reuse the hardened protocol/runtime layer.
```

If a future phase plan touches one of these boundaries, it must include an Effect boundary decision table entry and the relevant red-first tests from this document.
