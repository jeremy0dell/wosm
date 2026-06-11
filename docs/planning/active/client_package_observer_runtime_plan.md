# packages/client Observer Runtime Plan

Status: active plan
Date: 2026-06-11

## Purpose

Create `packages/client` as the shared rich-client runtime for WOSM apps that
consume observer truth.

This package should answer one boundary question:

> How does a long-running WOSM client stay synchronized with observer snapshots,
> events, commands, and reconnect state without each app rebuilding that logic?

The immediate product reason is Station's live observer mode. Station should
connect to the observer through the same proven boundary as `apps/tui`, but
duplicating the current TUI observer service and subscription loop as
Station-specific live code would create two parallel connectors.
`packages/client` should make Station's observer-connected WOSM overlay boring
to build.

This is not a prerequisite for all Station UI work. Station should also support
dev mock WOSM state from JSON fixtures so layout, overlays, input routing, and
visual testing can move before live observer wiring lands.

## Current Baseline

The current working shape is:

- `packages/contracts` owns shared snapshot, event, command, provider, diagnostic,
  and safe-error schemas and types. Snapshots carry `schemaVersion` and
  `generatedAt` but no revision, and events carry no sequence numbers, so a
  client cannot detect missed events.
- `packages/protocol` owns the observer NDJSON socket transport and validates
  request, response, and event messages. Its low-level client is
  `createObserverClient`. Protocol already owns command completion waiting:
  `client.waitForCommand` subscribes to command events before reading the
  command record so fast completions are not missed.
- `packages/runtime` owns generic IO helpers for timeout, retry, cancellation,
  external commands, and typed error conversion, and re-exports Effect
  primitives including `Schedule`.
- `apps/tui` currently owns the app-facing observer wrapper
  (`src/services/observerService.ts`), the event subscription loop and
  reconnect behavior (`src/state/store.ts`), event-to-snapshot application
  (`src/eventReducer/`), connection-state modeling, and thin command
  dispatch/wait wrappers over the protocol client. Today reconnect is a fixed
  100ms delay, each refresh-worthy event starts its own `snapshot.get`, and
  the loop performs a full snapshot refresh after every subscription gap
  before consuming incremental events again.

That was acceptable while TUI was the only rich client. Station makes this a
shared client concern.

## Proposed Boundary

Add a new root workspace package, `@wosm/client`:

```text
packages/client/
  package.json
  tsconfig.json
  src/
    commandLifecycle.ts
    connectionState.ts
    errors.ts
    observerRuntime.ts
    snapshotReducer.ts
    types.ts
    index.ts
  test/
```

Dependency direction:

```text
packages/client
  -> @wosm/contracts
  -> @wosm/protocol
  -> @wosm/runtime
```

No dependency on:

- React
- Ink
- OpenTUI
- Zustand
- `apps/tui`
- `experimental/station`
- terminal providers
- harness providers
- SQLite
- Worktrunk, tmux, git, or gh

## Ownership

`packages/client` owns:

- rich-client observer connection state
- initial snapshot loading
- observer event subscription lifecycle
- event-to-snapshot reduction
- reconnect/backoff behavior
- retryable-versus-permanent classification of observer/protocol failures
- stale/display-only state over the last good snapshot
- coalesced full snapshot refreshes
- command dispatch result normalization
- command completion waiting, as a thin wrapper over `protocol.waitForCommand`
- client-safe error normalization for observer/protocol failures
- framework-neutral runtime start/stop cleanup

`packages/client` does not own:

- rendering
- keymaps
- pane layout
- terminal process lifecycle
- OpenTUI or Ink integration
- Station workspace state
- TUI screen state
- provider adapters
- observer command handling
- protocol socket framing or schema validation
- command completion event-race handling (`protocol.waitForCommand` owns
  subscribing to command events before reading the command record)

The low-level socket client remains in `packages/protocol`. The generic timeout,
retry, cancellation, and safe-error primitives remain in `packages/runtime`.

## API Sketch

The package should expose framework-neutral primitives. Apps can adapt them into
Zustand, React context, OpenTUI providers, or plain component state.

```ts
type WosmClientRuntimeOptions = {
  socketPath: string;
  requestTimeoutMs?: number; // default 5_000, carried from the TUI service
  commandWaitTimeoutMs?: number; // default 35_000
  reconcileTimeoutMs?: number; // default 30_000
  reconnect?: {
    initialDelayMs?: number; // default 100
    maxDelayMs?: number; // default 5_000
  };
};

type WosmClientConnectionState =
  | { state: "idle" }
  | { state: "loading"; since: number }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; since: number; lastError: SafeError }
  | { state: "displayOnly"; since: number; lastError: SafeError }
  | { state: "halted"; since: number; lastError: SafeError };

type WosmClientRuntimeState = {
  snapshot?: WosmSnapshot;
  connection: WosmClientConnectionState;
  inFlightRefresh: boolean;
};

type WosmClientRuntime = {
  start(): void;
  stop(): Promise<void>;
  getState(): WosmClientRuntimeState;
  subscribe(listener: () => void): () => void;
  refresh(reason?: string): Promise<void>;
  reconcile(reason?: string): Promise<void>;
  dispatch(command: WosmCommand): Promise<WosmClientCommandResult>;
  waitForCommand(commandId: CommandId): Promise<WosmClientCommandCompletion>;
};

declare function createWosmClientRuntime(
  options: WosmClientRuntimeOptions,
): WosmClientRuntime;
```

API contracts:

- The factory is `createWosmClientRuntime`, named to avoid confusion with
  `protocol`'s `createObserverClient`. Instances are single-use: `start()` is
  idempotent while running; `stop()` is awaitable and idempotent; a stopped
  runtime is not restartable — create a new one.
- `getState()` returns an immutable state object that is replaced on every
  change and reference-stable between changes. Consumers rely on this for
  `useSyncExternalStore` and selector-equality patterns.
- `subscribe(listener)` notifies after each state replacement and returns an
  unsubscribe function. Listeners receive no payload; they read `getState()`.
- `dispatch` normalizes the protocol `CommandReceipt` (accepted/rejected) and
  dispatch failures into one result shape. `waitForCommand` normalizes the
  protocol `TerminalCommandRecord` (succeeded/failed) into one completion
  shape. Neither stores lifecycle state in the runtime.
- Timeout defaults carry over from the current TUI service so the extraction
  is behavior-preserving.

The exact names can still shift during implementation. The important part is
that the runtime is not a React provider and not a UI store. It is a plain
client runtime that apps can integrate.

## Connection State Machine

The runtime owns one connection state machine. The discriminating rule while
disconnected: `displayOnly` when a last good snapshot exists, `reconnecting`
when none does.

Transitions:

- `idle -> loading`: `start()` called.
- `loading -> connected`: initial snapshot loaded and subscription established.
- `loading -> reconnecting`: retryable failure before any snapshot exists.
- `connected -> connected`: clean subscription end. The runtime refreshes and
  resubscribes without leaving `connected` (matches current TUI behavior).
- `connected -> displayOnly`: retryable failure with a last good snapshot.
- `reconnecting/displayOnly -> connected`: resubscribe succeeded and the
  mandatory resync refresh completed. `connected` always means "subscribed and
  resynced", never merely "socket open".
- `any -> halted`: permanent error (see error classification). The last good
  snapshot, if any, stays available. The runtime stops retrying.
- `stop()` freezes the current state and ceases notifications; there is no
  dedicated stopped state.

PR 1 ships the full union, but `halted` transitions only activate with PR 2's
error classification.

## Reliability Goals

The extraction should improve client reliability rather than merely move
files — but the move and the improvements land separately. PR 1 preserves
current behavior exactly; the list below is the required end state after PR 2,
with each delta landed red-first behind a focused test.

Required behavior:

- one owned subscription loop per runtime instance
- explicit `start()` and awaitable `stop()`
- shutdown closes the client-side iterator, releases observer-side
  subscriptions, and cancels in-flight refreshes; no state change or listener
  notification may occur after `stop()` resolves (today an event-triggered
  refresh ignores the shutdown flag; the extraction must fix this)
- resync invariant: contracts carry no event sequence numbers, so missed
  events are undetectable. After every subscription gap — clean end or
  error — the runtime must complete a full snapshot refresh before trusting
  incremental events again. This is the only mechanism that keeps incremental
  patches correct. It must be an explicit, tested contract, not an accident of
  loop structure.
- events that arrive before the first snapshot is loaded are ignored; the
  initial load covers them
- reconnect uses bounded exponential backoff with jitter (default 100ms
  initial, 5s cap, configurable) instead of a tight fixed loop
- error classification: client `errors.ts` owns an explicit retryable-versus-
  permanent mapping over protocol `SafeError` codes. Connect failures,
  timeouts, and socket closes are retryable: back off and update connection
  state. `PROTOCOL_SCHEMA_MISMATCH` and protocol response/event validation
  failures are permanent: enter `halted`, stop retrying, keep the last good
  snapshot. Unknown codes default to retryable so transient failures self-heal
  at max backoff rather than parking wrongly.
- last good snapshot remains available during `displayOnly` and `halted`
- repeated connection failures update connection state instead of producing
  repeated user-facing toasts; presentation decisions, including the recovery
  toast and its threshold, stay in apps and are driven by the `since`
  timestamps
- schema mismatch and stale-observer errors have consistent messages across
  TUI and Station
- command dispatch accepts/rejects/fails with one normalized result shape

## Performance Goals

The runtime should avoid unnecessary observer and UI churn.

Required behavior:

- apply incremental events locally when the event is sufficient
- mark only specific event types as requiring a full snapshot refresh
- coalesce full refresh requests so multiple events do not create multiple
  concurrent `snapshot.get` calls (today each refresh-worthy event starts its
  own request)
- allow one in-flight refresh with a "refresh again after current one" flag
  when refresh-worthy events arrive during the request
- staleness invariant: an in-flight `snapshot.get` response must not erase
  newer state as the final word. If events were applied while a refresh was in
  flight, the runtime must either discard the stale response or schedule one
  more coalesced refresh after applying it. Cover this with a focused test.
- expose state changes so apps can subscribe narrowly or project with selectors
- avoid storing terminal output, renderer refs, or process handles in the client
  runtime

Selector and render memoization remain app responsibilities, but the runtime
should not force full-refresh storms or repeated connection-state noise.

## Implementation Notes

- Follow the Effect boundary rule in `docs/architecture.md`. The subscription
  loop, reconnect schedule, cancellation, and shutdown combine async streams
  with retry, cleanup, and timeout — exactly where Effect is preferred. Use
  Effect internally (`Schedule.exponential` composed with `Schedule.jittered`,
  re-exported by `@wosm/runtime`, plus scoped cleanup for iterator release)
  while exposing the plain Promise/subscribe public API. `protocol`'s
  `waitForCommand` already follows this pattern.
- `snapshotReducer.ts`, `connectionState.ts`, and other pure mappers stay
  plain TypeScript.
- Do not add backoff/jitter knobs to `packages/runtime`'s generic retry
  options for this work; the client composes `Schedule` directly. Promote a
  shared primitive only if a third consumer appears.
- Tests live in `packages/client/test/` per package convention.
- `exactOptionalPropertyTypes`: failure states carry a required `lastError`.
  TUI's current connection-status types mark it optional; the TUI bridge
  adapts.

## Migration Plan

### PR 1: Behavior-Preserving Extraction

Status: implemented (2026-06-11). Deviations from the sketch above, kept
deliberately small:

- The TUI bridge is hook-driven: the runtime exposes optional `onEvent`,
  `onSubscriptionError`, and `onRefreshSettled` callbacks that fire
  synchronously after each state swap, and the store derives its connection
  status, toasts, and local-operation effects from those hooks instead of
  mirroring `getState().connection`. The recovery-toast decision stays in the
  TUI bridge because existing store tests inject downtime directly into store
  state.
- `dispatch` returns the protocol `CommandReceipt` and `waitForCommand`
  returns `WosmClientCommandCompletion`; the sketch's normalized
  `WosmClientCommandResult` shape is deferred until TUI and Station share a
  command-status UI.
- Runtime instances are single-use: `start()` is idempotent while running and
  a stopped runtime does not restart.

Create `packages/client` and move the framework-neutral pieces out of TUI
without changing behavior:

- observer service request wrappers (`apps/tui/src/services/observerService.ts`)
- thin command dispatch/wait normalization over `protocol.waitForCommand`
- observer connection state helpers and connect-error detection
- event-to-snapshot reducer (`apps/tui/src/eventReducer/`)
- subscription loop with cleanup, ported as-is: fixed 100ms reconnect delay,
  per-event refreshes (no coalescing yet), and the existing
  refresh-after-every-gap loop behavior

Migrate `apps/tui` to consume `packages/client` through a store bridge while
preserving current TUI behavior and UI copy. TUI keeps Zustand; the store
subscribes to the runtime and mirrors observer state.

Mechanical checklist:

- add the `@wosm/client` path mapping to `tsconfig.base.json`
- package.json and tsconfig follow existing `packages/*` conventions;
  dependencies are only `@wosm/contracts`, `@wosm/protocol`, `@wosm/runtime`
- confirm the vitest configs cover `packages/client/test/`
- update the package list in `docs/architecture.md` in the same PR

Validation:

- focused `packages/client` unit tests (moved with the code)
- focused TUI store/service tests
- TUI app integration tests that cover loading, reconnect, event application,
  and command dispatch
- `pnpm test:all` (the deterministic gate; includes build, typecheck, lint)

### PR 2: Shared Runtime Reliability And Performance Deltas

Status: implemented (2026-06-11). Each delta landed red-first with focused
tests in `packages/client/test/unit/observerRuntimeReliability.test.ts` and
`errors.test.ts`:

- bounded exponential backoff with jitter replacing the fixed 100ms loop
- retryable-versus-permanent error classification and the `halted` state
- the resync-after-gap invariant as an explicit tested contract
- coalesced single-flight refresh with the refresh-again flag and the
  staleness invariant
- awaitable `stop()` covering in-flight refresh cancellation

Deviations from the sketch above, kept deliberately small:

- `connected` entry is never event-driven anymore, including the old
  pre-first-snapshot flip: it strictly means "subscribed and resynced",
  proven by a snapshot load that one live subscription spanned end to end
  (epoch gating). The TUI bridge still derives its own status from hooks, so
  TUI behavior and copy are unchanged.
- The resync runs at cycle start, subscribe-first, closing a recovery race in
  the ported loop: the old failure-path refresh ran before the sleep, so a
  resubscribe that succeeded after a failed refresh consumed events against
  the pre-outage snapshot with no reload. A retryably-failing resync now
  poisons its cycle so backoff retries subscribe and resync together; the
  start()-time refresh fork is gone (the first cycle's resync is the initial
  load).
- Caller `refresh()` joins the single-flight chain: the loaded snapshot
  applies, no hooks fire, failures rethrow untouched. A permanent error
  discovered by any flight halts the runtime (the caller still gets the
  rethrow).
- `reconcile()` stays an independent observer call but participates in the
  staleness and resync accounting (mutation bump plus epoch-gated connected).
- `PROTOCOL_SUBSCRIBE_ACK_MISMATCH` is classified permanent alongside the
  three mandated codes; it is the same build-incoherence family.
- `onSubscriptionError` info gained `willRetry: boolean`. Mirroring `halted`
  into the TUI status presentation is deferred to the cross-app messaging
  work; the existing dedup already surfaces the error toast once.
- `stop()` is prompt abandonment with a hard mutation freeze rather than a
  literal cancellation: `loadSnapshot` is not abortable through protocol, so
  stop does not await an in-flight load — it freezes state and hooks so
  nothing observable happens after `stop()` resolves, and the service's own
  request timeout drains the abandoned flight.
- The reconnect option is `reconnect: { initialDelayMs?, maxDelayMs? }`,
  replacing `reconnectDelayMs`. The bloat audit also removed the unused
  `EVENT_STREAM_RECONNECT_DELAY_MS` export, its dead TUI re-export, the
  `refreshDepth` counter, and the consumerless `@wosm/client` re-exports in
  the TUI index (`applyWosmEvent`, `createTuiObserverService`, and friends).

Validation: focused `packages/client` tests per delta, TUI suites green with
no edits beyond the dead re-export removals, `pnpm test:all`.

### PR 3: Station Read-Only Observer Overlay

Use `packages/client` from Station to render live observer state in the WOSM
overlay, behind the same Station WOSM state provider used by mock mode. This
PR must first prove the dependency mechanics described in Station Dependency
below — including the doctor check — before building UI on them.

This PR should not add real PTY panes yet. It should prove that Station can
consume observer truth through the shared client runtime and render a useful
read-only overlay.

Validation:

- Station host/container run shows live projects, worktrees, sessions, and agent
  statuses when the observer is available
- stopping the observer leaves the last good state visible with a calm
  reconnect/display-only status
- existing TUI behavior remains unchanged

### PR 4: Station Commands Through Shared Client

Add minimal Station command dispatch through `packages/client`, likely starting
with reconcile/refresh and one focus or create command only after the Station
input router exists.

Do not make Station a terminal provider in this phase.

## Station Dependency

Live observer-connected Station work depends on `packages/client`.

Station can continue rendering local layout prototypes and mock WOSM overlay
states without this package. Mock mode should use contract-shaped JSON fixtures
inside `experimental/station` and should not connect to the observer socket.

The WOSM overlay should not grow a Station-specific live observer connector. If a
Station PR needs live observer snapshots or commands, it should either:

1. land after `packages/client`, or
2. explicitly be a throwaway local demo that will be replaced by
   `packages/client` before promotion.

This keeps Station from creating a second TUI-style client loop and gives WOSM a
single place to improve rich-client reliability and performance.

### Consuming packages/client From The Isolated Station Workspace

`experimental/station` is intentionally outside the root pnpm workspace and
uses Bun, so `workspace:*` cannot resolve `@wosm/client` from Station, and the
transitive `workspace:*` ranges inside `@wosm/client`'s own dependencies will
not resolve either.

Chosen mechanism:

- the Station app declares a `file:` dependency on `packages/client`
- Station's workspace root `package.json` adds Bun `overrides` mapping the
  full transitive graph — `@wosm/client`, `@wosm/contracts`, `@wosm/protocol`,
  `@wosm/runtime` — to repo-relative paths so the inner `workspace:*` ranges
  resolve locally
- the packages must be built first (`pnpm build` at the repo root); the
  Station doctor script (`experimental/station/scripts/doctor.sh`) must check
  that the dists exist and fail with a clear message
- all of this stays inside `experimental/station` per the spike isolation
  rules; nothing is added to the root workspace or root scripts

If Bun's `file:` plus overrides combination proves unreliable, fall back to
`bun link` for the four packages or `pnpm pack` tarballs with the same
overrides. The first observer-connected Station PR proves whichever mechanism
lands.

## Non-Goals

Do not use this package to:

- introduce a Station terminal provider
- move observer command handling out of `apps/observer`
- move protocol socket framing out of `packages/protocol`
- move generic timeout/retry primitives out of `packages/runtime`
- reimplement `protocol.waitForCommand`'s subscribe-before-read race handling
  in client code
- add event sequence numbers, event replay, or other observer/protocol
  contract changes (possible future hardening, separate plan)
- add React, Ink, OpenTUI, or Zustand dependencies
- normalize provider-specific payloads in client code
- expose raw `providerData` to ordinary UI surfaces
- build terminal pane or PTY abstractions

## Resolved Decisions

These were the open questions; they are now decided:

- Package name: `@wosm/client`, matching the one-word convention of
  `contracts`, `protocol`, and `runtime`; the name is unused today. The
  factory is `createWosmClientRuntime` to avoid confusion with `protocol`'s
  `createObserverClient`.
- TUI keeps its Zustand store and bridges to the client runtime in PR 1.
  Making the runtime the source for observer state, with Zustand keeping only
  screen/local UI state, is a separate optional change after Station consumes
  the API.
- Event classification ports the existing TUI reducer unchanged:
  worktree/session/agent events apply incrementally; `provider.healthChanged`,
  `observer.reconciled`, `project.updated`, and provider hook events force a
  full refresh; unknown event types default to full refresh as the
  forward-compatibility safety net.
- Command lifecycle state stays out of runtime state. `dispatch` and
  `waitForCommand` remain request/response helpers until TUI and Station share
  a concrete command-status UI.
- Minimum Station read-only API: `start`, `stop`, `getState`, `subscribe`,
  `refresh`.

## Deferred Questions

- Should the runtime eventually become the source of truth for TUI observer
  state, with Zustand holding only screen state? Revisit after Station
  consumes the API.
- Should the observer add event sequence numbers or replay so clients can
  detect gaps without full refreshes? Only worth a plan if
  refresh-on-resubscribe proves too coarse in practice.

## Success Criteria

- `packages/client` exists, is framework-neutral, and TUI consumes it for
  observer snapshot/event/command behavior with no user-visible behavior
  change in PR 1.
- The PR 2 deltas — jittered bounded backoff, permanent-error `halted` state,
  the resync-after-gap contract, coalesced refresh with the staleness
  invariant, awaitable shutdown — each land red-first with focused tests.
- The shared runtime has focused tests for reconnect cleanup, coalesced
  refresh, incremental event application, and command lifecycle normalization.
- Station's observer-connected WOSM overlay can be built without a
  Station-specific observer connector, and the Station dependency mechanics
  are proven by a doctor check before overlay UI lands.
- Station can still make UI progress before `packages/client` by using mock WOSM
  state fixtures behind the same provider boundary.
- `docs/architecture.md` lists `packages/client` after PR 1.
