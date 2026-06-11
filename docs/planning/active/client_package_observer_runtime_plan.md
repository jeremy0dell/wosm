# packages/client Observer Runtime Plan

Status: active plan
Date: 2026-06-11

## Purpose

Create `packages/client` as the shared rich-client runtime for WOSM apps that
consume observer truth.

This package should answer one boundary question:

> How does a long-running WOSM client stay synchronized with observer snapshots,
> events, commands, and reconnect state without each app rebuilding that logic?

The immediate product reason is Station. Station should connect to the observer
through the same proven boundary as `apps/tui`, but duplicating the current TUI
observer service and subscription loop as Station-specific code would create two
parallel connectors. `packages/client` should make Station's observer-connected
WOSM overlay boring to build.

## Current Baseline

The current working shape is:

- `packages/contracts` owns shared snapshot, event, command, provider, diagnostic,
  and safe-error schemas and types.
- `packages/protocol` owns the observer NDJSON socket transport and validates
  request, response, and event messages. Its low-level client is
  `createObserverClient`.
- `packages/runtime` owns generic IO helpers for timeout, retry, cancellation,
  external commands, and typed error conversion.
- `apps/tui` currently owns the app-facing observer wrapper, event subscription
  loop, reconnect behavior, event-to-snapshot application, command dispatch, and
  command-wait behavior.

That was acceptable while TUI was the only rich client. Station makes this a
shared client concern.

## Proposed Boundary

Add a new root workspace package:

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
- stale/display-only state over the last good snapshot
- coalesced full snapshot refreshes
- command dispatch result normalization
- command completion waiting
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

The low-level socket client remains in `packages/protocol`. The generic timeout,
retry, cancellation, and safe-error primitives remain in `packages/runtime`.

## API Sketch

The package should expose framework-neutral primitives. Apps can adapt them into
Zustand, React context, OpenTUI providers, or plain component state.

```ts
type WosmClientConnectionState =
  | { state: "idle" }
  | { state: "loading"; since: number }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; since: number; lastError: SafeError }
  | { state: "displayOnly"; since: number; lastError: SafeError };

type WosmClientRuntimeState = {
  snapshot?: WosmSnapshot;
  connection: WosmClientConnectionState;
  inFlightRefresh: boolean;
};

type WosmClientRuntime = {
  start(): void;
  stop(): void;
  getState(): WosmClientRuntimeState;
  subscribe(listener: () => void): () => void;
  refresh(reason?: string): Promise<void>;
  reconcile(reason?: string): Promise<void>;
  dispatch(command: WosmCommand): Promise<WosmClientCommandResult>;
  waitForCommand(commandId: CommandId): Promise<WosmClientCommandCompletion>;
};
```

The exact names can change during implementation. The important part is that the
runtime is not a React provider and not a UI store. It is a plain client runtime
that apps can integrate.

## Reliability Goals

The extraction should improve client reliability rather than merely move files.

Required behavior:

- one owned subscription loop per runtime instance
- explicit `start()` and `stop()`
- shutdown closes the client-side iterator and releases observer-side
  subscriptions
- reconnect uses bounded backoff with jitter instead of a tight fixed loop
- last good snapshot remains available during reconnect/display-only state
- repeated connection failures update connection state instead of producing
  repeated user-facing toasts
- schema mismatch and stale-observer errors have consistent messages across TUI
  and Station
- command dispatch accepts/rejects/fails with one normalized result shape

## Performance Goals

The runtime should avoid unnecessary observer and UI churn.

Required behavior:

- apply incremental events locally when the event is sufficient
- mark only specific event types as requiring a full snapshot refresh
- coalesce full refresh requests so multiple events do not create multiple
  concurrent `snapshot.get` calls
- allow one in-flight refresh with a "refresh again after current one" flag when
  refresh-worthy events arrive during the request
- expose state changes so apps can subscribe narrowly or project with selectors
- avoid storing terminal output, renderer refs, or process handles in the client
  runtime

Selector and render memoization remain app responsibilities, but the runtime
should not force full-refresh storms or repeated connection-state noise.

## Migration Plan

### PR 1: Extract Shared Client Runtime

Create `packages/client` and move the framework-neutral pieces out of TUI:

- observer service request wrappers
- command wait normalization
- observer connection state helpers
- event-to-snapshot reducer
- subscription loop with cleanup
- coalesced refresh behavior

Migrate `apps/tui` to consume `packages/client` while preserving current TUI
behavior and UI copy.

Validation:

- focused `packages/client` unit tests
- focused TUI store/service tests
- TUI app integration tests that cover loading, reconnect, event application, and
  command dispatch
- `pnpm build`
- `pnpm typecheck`

### PR 2: Station Read-Only Observer Overlay

Use `packages/client` from Station to render live observer state in the WOSM
overlay.

This PR should not add real PTY panes yet. It should prove that Station can
consume observer truth through the shared client runtime and render a useful
read-only overlay.

Validation:

- Station host/container run shows live projects, worktrees, sessions, and agent
  statuses when the observer is available
- stopping the observer leaves the last good state visible with a calm
  reconnect/display-only status
- existing TUI behavior remains unchanged

### PR 3: Station Commands Through Shared Client

Add minimal Station command dispatch through `packages/client`, likely starting
with reconcile/refresh and one focus or create command only after the Station
input router exists.

Do not make Station a terminal provider in this phase.

## Station Dependency

Observer-connected Station work depends on `packages/client`.

Station can continue rendering local layout prototypes without this package, but
the WOSM overlay should not grow a Station-specific observer connector. If a
Station PR needs live observer snapshots or commands, it should either:

1. land after `packages/client`, or
2. explicitly be a throwaway local demo that will be replaced by
   `packages/client` before promotion.

This keeps Station from creating a second TUI-style client loop and gives WOSM a
single place to improve rich-client reliability and performance.

## Non-Goals

Do not use this package to:

- introduce a Station terminal provider
- move observer command handling out of `apps/observer`
- move protocol socket framing out of `packages/protocol`
- move generic timeout/retry primitives out of `packages/runtime`
- add React, Ink, OpenTUI, or Zustand dependencies
- normalize provider-specific payloads in client code
- expose raw `providerData` to ordinary UI surfaces
- build terminal pane or PTY abstractions

## Open Questions

- Should the package name be `@wosm/client` or `@wosm/observer-client`?
- Should TUI keep its Zustand store and bridge to the client runtime, or should
  the runtime become the source for observer state while TUI keeps only
  screen/local UI state in Zustand?
- Which event types should remain incremental versus force a full snapshot
  refresh?
- Should command lifecycle state be stored inside the runtime, or should
  `dispatch` and `waitForCommand` stay request/response helpers until TUI and
  Station share a concrete command-status UI?
- What is the minimum public API Station needs for the first read-only WOSM
  overlay?

## Success Criteria

- `packages/client` exists and is framework-neutral.
- TUI uses the shared client runtime for observer snapshot/event/command
  behavior.
- TUI behavior remains unchanged from the user's perspective.
- The shared runtime has focused tests for reconnect cleanup, coalesced refresh,
  incremental event application, and command lifecycle normalization.
- Station's observer-connected WOSM overlay can be built without a
  Station-specific observer connector.
