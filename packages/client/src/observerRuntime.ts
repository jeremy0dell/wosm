import type { SafeError, WosmEvent, WosmSnapshot } from "@wosm/contracts";
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

type RefreshSource = "managed" | "caller";

type RefreshFlightRequest = {
  source: RefreshSource;
  resolve(outcome: RefreshFlightOutcome): void;
};

type RefreshFlightOutcome =
  | { status: "loaded"; snapshot: WosmSnapshot }
  | { status: "connectFailure"; error: SafeError; raw: unknown }
  | { status: "failure"; error: SafeError; raw: unknown };

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
  let cycleMadeProgress = false;
  let stopRequested = false;
  let refreshChainRunning = false;
  let mutationCounter = 0;
  const pendingRefreshRequests: RefreshFlightRequest[] = [];
  let loopFiber: Fiber.RuntimeFiber<void> | undefined;

  const isActive = (): boolean => active;

  // Once stop() has been requested the state is frozen: no replacement and no
  // listener notification may happen after stop() resolves.
  function swapState(next: WosmClientRuntimeState): void {
    if (stopRequested) {
      return;
    }
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

  function setInFlightRefresh(value: boolean): void {
    if (state.inFlightRefresh !== value) {
      swapState({ ...state, inFlightRefresh: value });
    }
  }

  // One snapshot request flies at a time. Requests landing while a flight is
  // airborne are served by the next flight, which by construction starts at
  // or after the request. A flight whose response raced applied events chains
  // one more managed flight so a stale response is never the final word.
  function requestRefresh(source: RefreshSource): Promise<RefreshFlightOutcome> {
    return new Promise((resolve) => {
      pendingRefreshRequests.push({ source, resolve });
      if (!refreshChainRunning) {
        refreshChainRunning = true;
        setInFlightRefresh(true);
        void runRefreshChain();
      }
    });
  }

  async function runRefreshChain(): Promise<void> {
    try {
      while (pendingRefreshRequests.length > 0) {
        const requests = pendingRefreshRequests.splice(0);
        const flightSource: RefreshSource = requests.some((request) => request.source === "managed")
          ? "managed"
          : "caller";
        const mutationsAtStart = mutationCounter;
        const outcome = await loadFlightOutcome();
        if (!stopRequested) {
          applyFlightOutcome(outcome, flightSource);
        }
        for (const request of requests) {
          request.resolve(outcome);
        }
        const mutated = mutationCounter !== mutationsAtStart;
        if (
          !stopRequested &&
          outcome.status === "loaded" &&
          mutated &&
          pendingRefreshRequests.length === 0
        ) {
          pendingRefreshRequests.push({ source: "managed", resolve: () => undefined });
        }
      }
    } finally {
      refreshChainRunning = false;
      setInFlightRefresh(false);
    }
  }

  async function loadFlightOutcome(): Promise<RefreshFlightOutcome> {
    try {
      const snapshot = await service.loadSnapshot();
      return { status: "loaded", snapshot };
    } catch (raw: unknown) {
      const error = toSafeError(raw);
      if (isObserverConnectError(error)) {
        return { status: "connectFailure", error, raw };
      }
      return { status: "failure", error, raw };
    }
  }

  // Ports the TUI store refresh: loaded snapshots flip the connection to
  // connected, connect failures flip to displayOnly/reconnecting, and other
  // failures leave the connection untouched (apps surface them via the hook).
  // Caller-sourced flights apply the snapshot but fire no hooks and never
  // touch failure state; refresh() callers keep their own error handling.
  function applyFlightOutcome(outcome: RefreshFlightOutcome, source: RefreshSource): void {
    if (outcome.status === "loaded") {
      applyLoadedSnapshot(outcome.snapshot);
      if (source === "managed") {
        hooks.onRefreshSettled?.({ status: "loaded", snapshot: outcome.snapshot });
      }
      return;
    }
    if (source === "caller") {
      return;
    }
    if (outcome.status === "connectFailure") {
      applyConnectionFailure(outcome.error);
      hooks.onRefreshSettled?.({ status: "connectFailure", error: outcome.error });
      return;
    }
    hooks.onRefreshSettled?.({ status: "failure", error: outcome.error });
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
    mutationCounter += 1;
    swapState({
      ...state,
      snapshot: application.snapshot,
      connection: connectedConnectionState(state.connection, Date.now()),
    });
    hooks.onEvent?.(event, application);
    if (application.needsSnapshotRefresh) {
      void requestRefresh("managed");
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
    await requestRefresh("managed");
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
        await requestRefresh("managed");
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
      void requestRefresh("managed");
    } else {
      swapState({ ...state, connection: connectedConnectionState(state.connection, Date.now()) });
    }
    loopFiber = Effect.runFork(subscriptionLoop);
  }

  async function performStop(): Promise<void> {
    stopRequested = true;
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
      // Caller-owned refresh joins the single-flight chain: the loaded
      // snapshot applies to runtime state, but no hooks fire and failures
      // rethrow untouched, so operation call sites keep their error handling.
      const outcome = await requestRefresh("caller");
      if (outcome.status !== "loaded") {
        throw outcome.raw;
      }
    },
    reconcile: async (reason?: string): Promise<void> => {
      const loaded = await service.reconcile(reason);
      if (stopRequested) {
        return;
      }
      mutationCounter += 1;
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
