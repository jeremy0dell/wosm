import type { WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { Duration, Effect, Fiber, Schedule } from "@wosm/runtime";
import {
  connectedConnectionState,
  failureConnectionState,
  isObserverConnectError,
} from "./connectionState.js";
import { toSafeError } from "./errors.js";
import { createObserverService } from "./observerService.js";
import { applyWosmEvent } from "./snapshotReducer.js";
import type {
  ObserverService,
  WosmClientRuntime,
  WosmClientRuntimeHooks,
  WosmClientRuntimeOptions,
  WosmClientRuntimeState,
} from "./types.js";

const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 100;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;

export function createWosmClientRuntime(options: WosmClientRuntimeOptions): WosmClientRuntime {
  const service = resolveService(options);
  const hooks: WosmClientRuntimeHooks = options.hooks ?? {};
  const initialDelayMs = options.reconnect?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
  const maxDelayMs = options.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;

  let state = initialRuntimeState(options.initialSnapshot);
  const listeners = new Set<() => void>();
  let active = false;
  let started = false;
  let stopPromise: Promise<void> | undefined;
  let currentIterator: AsyncIterator<WosmEvent> | undefined;
  let reportedSubscriptionError = false;
  let refreshDepth = 0;
  let cycleMadeProgress = false;
  let loopFiber: Fiber.RuntimeFiber<void> | undefined;

  const isActive = (): boolean => active;

  function swapState(next: WosmClientRuntimeState): void {
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function applyConnectionFailure(error: ReturnType<typeof toSafeError>): void {
    swapState({
      ...state,
      connection: failureConnectionState(
        state.connection,
        error,
        state.snapshot !== undefined,
        Date.now(),
      ),
    });
  }

  function applyLoadedSnapshot(snapshot: WosmSnapshot): void {
    swapState({
      ...state,
      snapshot,
      connection: connectedConnectionState(state.connection, Date.now()),
    });
  }

  function beginRefresh(): void {
    refreshDepth += 1;
    if (!state.inFlightRefresh) {
      swapState({ ...state, inFlightRefresh: true });
    }
  }

  function endRefresh(): void {
    refreshDepth -= 1;
    if (refreshDepth === 0 && state.inFlightRefresh) {
      swapState({ ...state, inFlightRefresh: false });
    }
  }

  // Ports the TUI store refresh: loaded snapshots flip the connection to
  // connected, connect failures flip to displayOnly/reconnecting, and other
  // failures leave the connection untouched (apps surface them via the hook).
  async function runManagedRefresh(isActiveGuard: () => boolean): Promise<void> {
    beginRefresh();
    try {
      const loaded = await service.loadSnapshot();
      if (!isActiveGuard()) return;
      applyLoadedSnapshot(loaded);
      hooks.onRefreshSettled?.({ status: "loaded", snapshot: loaded });
    } catch (error: unknown) {
      if (!isActiveGuard()) return;
      const safeError = toSafeError(error);
      if (isObserverConnectError(safeError)) {
        applyConnectionFailure(safeError);
        hooks.onRefreshSettled?.({ status: "connectFailure", error: safeError });
        return;
      }
      hooks.onRefreshSettled?.({ status: "failure", error: safeError });
    } finally {
      endRefresh();
    }
  }

  function applyEvent(event: WosmEvent): void {
    reportedSubscriptionError = false;
    cycleMadeProgress = true;
    if (state.snapshot === undefined) {
      // Events arriving before the first snapshot still prove the observer is
      // reachable, but cannot be reduced; the in-flight initial load covers them.
      if (state.connection.state !== "connected") {
        swapState({ ...state, connection: connectedConnectionState(state.connection, Date.now()) });
      }
      hooks.onEvent?.(event, undefined);
      return;
    }
    const application = applyWosmEvent(state.snapshot, event);
    swapState({
      ...state,
      snapshot: application.snapshot,
      connection: connectedConnectionState(state.connection, Date.now()),
    });
    hooks.onEvent?.(event, application);
    if (application.needsSnapshotRefresh) {
      // Ported quirk: event-triggered refreshes ignore stop() so a refresh
      // already owed to a reduced event still lands; PR 2 removes this with
      // cancellable shutdown.
      void runManagedRefresh(() => true);
    }
  }

  async function handleSubscriptionFailure(error: unknown): Promise<void> {
    const safeError = toSafeError(error);
    if (isObserverConnectError(safeError)) {
      applyConnectionFailure(safeError);
      reportedSubscriptionError = false;
      hooks.onSubscriptionError?.(safeError, { isConnectError: true, alreadyReported: false });
    } else {
      const alreadyReported = reportedSubscriptionError;
      reportedSubscriptionError = true;
      hooks.onSubscriptionError?.(safeError, { isConnectError: false, alreadyReported });
    }
    await runManagedRefresh(isActive);
  }

  function openIterator(): AsyncIterator<WosmEvent> {
    const iterator = service.subscribeEvents()[Symbol.asyncIterator]();
    currentIterator = iterator;
    return iterator;
  }

  function releaseIterator(): void {
    const iterator = currentIterator;
    currentIterator = undefined;
    void iterator?.return?.();
  }

  const subscriptionCycle: Effect.Effect<void> = Effect.tryPromise({
    try: async () => {
      const iterator = openIterator();
      await consumeCurrentSubscription(iterator, isActive, applyEvent);
      cycleMadeProgress = true;
      if (active) {
        // Resync after every subscription gap: events have no sequence numbers,
        // so a full snapshot reload is what keeps incremental patches correct.
        await runManagedRefresh(isActive);
      }
    },
    catch: (error) => error,
  }).pipe(
    Effect.catchAll((error) =>
      Effect.promise(async () => {
        if (!active) return;
        await handleSubscriptionFailure(error);
      }),
    ),
    Effect.ensuring(Effect.sync(releaseIterator)),
  );

  // The driver feeds the jittered exponential schedule into the loop: each
  // failed cycle escalates the next sleep, while a cycle that subscribed
  // successfully (an event arrived or the stream ended cleanly) resets the
  // sequence so the next attempt waits only the initial delay.
  const subscriptionLoop: Effect.Effect<void> = Effect.gen(function* () {
    const driver = yield* Schedule.driver(reconnectSchedule(initialDelayMs, maxDelayMs));
    while (active) {
      cycleMadeProgress = false;
      yield* subscriptionCycle;
      if (!active) {
        return;
      }
      if (cycleMadeProgress) {
        yield* driver.reset;
      }
      yield* driver.next(undefined);
    }
  }).pipe(Effect.orDie);

  function start(): void {
    if (started || stopPromise !== undefined) {
      return;
    }
    started = true;
    active = true;
    if (state.snapshot === undefined) {
      swapState({ ...state, connection: { state: "loading", since: Date.now() } });
      void runManagedRefresh(isActive);
    } else {
      swapState({ ...state, connection: connectedConnectionState(state.connection, Date.now()) });
    }
    loopFiber = Effect.runFork(subscriptionLoop);
  }

  async function performStop(): Promise<void> {
    active = false;
    // Returning the iterator first unblocks a pending next() so the loop fiber
    // reaches an interruption point instead of waiting out the subscription.
    const iterator = currentIterator;
    currentIterator = undefined;
    try {
      await iterator?.return?.();
    } catch {
      // Iterator cleanup failures must not block shutdown.
    }
    if (loopFiber !== undefined) {
      await Effect.runPromise(Fiber.interrupt(loopFiber)).catch(() => undefined);
    }
  }

  return {
    start,
    stop: (): Promise<void> => {
      stopPromise ??= performStop();
      return stopPromise;
    },
    getState: () => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async (_reason?: string): Promise<void> => {
      // Caller-owned refresh: applies the loaded snapshot to runtime state but
      // fires no hooks and rethrows failures untouched, so operation call sites
      // keep their existing error handling.
      beginRefresh();
      try {
        const loaded = await service.loadSnapshot();
        applyLoadedSnapshot(loaded);
      } finally {
        endRefresh();
      }
    },
    reconcile: async (reason?: string): Promise<void> => {
      const loaded = await service.reconcile(reason);
      applyLoadedSnapshot(loaded);
      hooks.onRefreshSettled?.({ status: "loaded", snapshot: loaded });
    },
    dispatch: (command) => service.dispatch(command),
    waitForCommand: (commandId) => service.waitForCommandCompletion(commandId),
  };
}

// Jitter before the union so maxDelayMs is a hard bound: the union sleeps the
// minimum of the jittered exponential delay and the constant cap.
function reconnectSchedule(initialDelayMs: number, maxDelayMs: number) {
  return Schedule.exponential(Duration.millis(initialDelayMs)).pipe(
    Schedule.jittered,
    Schedule.union(Schedule.spaced(Duration.millis(maxDelayMs))),
  );
}

function resolveService(options: WosmClientRuntimeOptions): ObserverService {
  if (options.service !== undefined) {
    return options.service;
  }
  if (options.socketPath === undefined) {
    throw new Error("createWosmClientRuntime requires service or socketPath.");
  }
  return createObserverService({
    socketPath: options.socketPath,
    ...(options.requestTimeoutMs === undefined ? {} : { timeoutMs: options.requestTimeoutMs }),
    ...(options.reconcileTimeoutMs === undefined
      ? {}
      : { reconcileTimeoutMs: options.reconcileTimeoutMs }),
    ...(options.commandWaitTimeoutMs === undefined
      ? {}
      : { commandWaitTimeoutMs: options.commandWaitTimeoutMs }),
  });
}

function initialRuntimeState(initialSnapshot: WosmSnapshot | undefined): WosmClientRuntimeState {
  const base: WosmClientRuntimeState = {
    connection: { state: "idle" },
    inFlightRefresh: false,
  };
  if (initialSnapshot !== undefined) {
    base.snapshot = initialSnapshot;
  }
  return base;
}

async function consumeCurrentSubscription(
  iterator: AsyncIterator<WosmEvent>,
  isActive: () => boolean,
  handleEvent: (event: WosmEvent) => void,
): Promise<void> {
  for (;;) {
    const next = await iterator.next();
    if (!isActive()) {
      return;
    }
    if (next.done) {
      return;
    }
    handleEvent(next.value);
  }
}
