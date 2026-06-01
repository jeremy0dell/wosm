import type {
  CommandReceipt,
  TerminalFocusOrigin,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import { createStore, type StoreApi } from "zustand/vanilla";
import { applyWosmEvent } from "../eventReducer/eventReducer.js";
import { safeErrorToToast, toSafeError } from "../services/errors/errors.js";
import type { TuiObserverService, TuiToast } from "../services/types.js";
import { clampDashboardStateScroll } from "./dashboardScroll.js";
import type { TuiKey } from "./keys.js";
import {
  createTuiLocalOperationRunner,
  type TuiLocalOperationRunner,
} from "./operations/localOperationRunner.js";
import { prepareCommandForRuntime, withResolvedFocusOrigin } from "./operations/runtimeCommands.js";
import {
  addTuiToast,
  addTuiToasts,
  type CreateInitialTuiStateOptions,
  createInitialTuiState,
  replaceSnapshot,
  type TuiState,
} from "./screen.js";
import { handleTuiKey, type TuiTransition } from "./transition.js";

const EVENT_STREAM_RECONNECT_DELAY_MS = 100;

export type TuiStore = TuiState & {
  start(): () => void;
  handleKey(key: TuiKey): void;
  handleObserverEvent(event: WosmEvent): void;
  setTerminalRows(rows: number): void;
  dismissToasts(): void;
};

export type TuiStoreOptions = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  initialState?: Omit<CreateInitialTuiStateOptions, "initialSnapshot" | "runtime">;
  exitOnFocusSuccess?: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
  persistentPopup?: boolean;
  onExit?: (code: number) => void;
};

export function createTuiStore(options: TuiStoreOptions): StoreApi<TuiStore> {
  const runtime = createRuntimeOptions(options);
  let store: StoreApi<TuiStore>;
  const operations = createTuiLocalOperationRunner({
    getStore: () => store,
    service: options.service,
    runtime,
  });

  store = createStore<TuiStore>()((set, get) => ({
    ...createInitialTuiState({
      ...(options.initialState ?? {}),
      ...(options.initialSnapshot === undefined
        ? {}
        : { initialSnapshot: options.initialSnapshot }),
      runtime: {
        persistentPopup: runtime.persistentPopup,
        canDismissPopup: runtime.onDismiss !== undefined,
        exitOnFocusSuccess: runtime.exitOnFocusSuccess,
        canResolveFocusOrigin: runtime.resolveFocusOrigin !== undefined,
        hasFocusSuccessCallback: runtime.onFocusSuccess !== undefined,
        ...(runtime.focusOrigin === undefined ? {} : { focusOrigin: runtime.focusOrigin }),
      },
    }),
    start: (): (() => void) => startStoreRuntime(store, options.service),
    handleKey: (key): void => {
      const transition = handleTuiKey(get(), key);
      set(transition.state);
      void applyTransitionEffects(store, options.service, runtime, operations, transition);
    },
    handleObserverEvent: (event): void => {
      handleObserverEvent(store, options.service, operations, event);
    },
    setTerminalRows: (rows): void => {
      set(clampDashboardStateScroll({ ...get(), terminalRows: rows }));
    },
    dismissToasts: (): void => {
      set({ toasts: [] });
    },
  }));

  return store;
}

type RuntimeOptions = {
  exitOnFocusSuccess: boolean;
  persistentPopup: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
  onFocusSuccess?: () => Promise<void>;
  onDismiss?: () => Promise<void>;
  onExit?: (code: number) => void;
};

function createRuntimeOptions(options: TuiStoreOptions): RuntimeOptions {
  const runtime: RuntimeOptions = {
    exitOnFocusSuccess: options.exitOnFocusSuccess === true,
    persistentPopup: options.persistentPopup === true,
  };
  if (options.focusOrigin !== undefined) {
    runtime.focusOrigin = options.focusOrigin;
  }
  if (options.resolveFocusOrigin !== undefined) {
    runtime.resolveFocusOrigin = options.resolveFocusOrigin;
  }
  if (options.onFocusSuccess !== undefined) {
    runtime.onFocusSuccess = options.onFocusSuccess;
  }
  if (options.onDismiss !== undefined) {
    runtime.onDismiss = options.onDismiss;
  }
  if (options.onExit !== undefined) {
    runtime.onExit = options.onExit;
  }
  return runtime;
}

function startStoreRuntime(store: StoreApi<TuiStore>, service: TuiObserverService): () => void {
  let active = true;
  let currentIterator: AsyncIterator<WosmEvent> | undefined;
  let reportedSubscriptionError = false;

  const isActive = () => active;
  const refreshCurrentSnapshot = async () => {
    await refreshSnapshot(store, service, isActive);
  };

  if (store.getState().snapshot === undefined) {
    void refreshCurrentSnapshot();
  }

  async function consumeEvents() {
    while (active) {
      try {
        currentIterator = service.subscribeEvents()[Symbol.asyncIterator]();
        await consumeCurrentSubscription(currentIterator, isActive, (event) => {
          reportedSubscriptionError = false;
          store.getState().handleObserverEvent(event);
        });
        if (active) {
          await refreshCurrentSnapshot();
        }
      } catch (error: unknown) {
        if (!active) return;
        if (!reportedSubscriptionError) {
          addToast(store, safeErrorToToast(toSafeError(error)));
          reportedSubscriptionError = true;
        }
        await refreshCurrentSnapshot();
      } finally {
        const iterator = currentIterator;
        currentIterator = undefined;
        void iterator?.return?.();
      }
      if (active) {
        await delay(EVENT_STREAM_RECONNECT_DELAY_MS);
      }
    }
  }

  void consumeEvents();

  return () => {
    active = false;
    const iterator = currentIterator;
    currentIterator = undefined;
    void iterator?.return?.();
  };
}

function handleObserverEvent(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  operations: TuiLocalOperationRunner,
  event: WosmEvent,
): void {
  const current = store.getState();
  if (current.snapshot === undefined) {
    return;
  }

  const commandFailureHandling =
    event.type === "command.failed" ? operations.prepareCommandFailedEvent(event) : undefined;
  const result = applyWosmEvent(current.snapshot, event);
  store.setState(
    clampDashboardStateScroll(
      addTuiToasts(
        replaceSnapshot(current, result.snapshot),
        commandFailureHandling?.suppressReducerToast === true ? [] : result.toasts,
      ),
    ),
  );
  commandFailureHandling?.applyLocalEffect();
  if (result.needsSnapshotRefresh) {
    void refreshSnapshot(store, service, () => true);
  }
}

async function applyTransitionEffects(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  runtime: RuntimeOptions,
  operations: TuiLocalOperationRunner,
  transition: TuiTransition,
): Promise<void> {
  if (transition.dismissPopup === true && runtime.onDismiss !== undefined) {
    await dismissPersistentPopup(store, runtime.onDismiss);
  }

  if (transition.exitCode !== undefined) {
    runtime.onExit?.(transition.exitCode);
  }

  if (transition.reconcileReason !== undefined) {
    await reconcileSnapshot(store, service, transition.reconcileReason);
  }

  for (const command of transition.commands ?? []) {
    if (shouldUseFocusLifecycle(command, runtime)) {
      await dispatchFocusWithLifecycle(store, service, command, runtime);
    } else {
      try {
        const prepared = await prepareCommandForRuntime(command, runtime);
        await dispatchCommand(store, service, prepared);
      } catch (error: unknown) {
        addToast(store, safeErrorToToast(toSafeError(error)));
      }
    }
  }

  operations.run(transition.operations);
}

async function refreshSnapshot(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  isActive: () => boolean,
): Promise<void> {
  try {
    const loaded = await service.loadSnapshot();
    if (!isActive()) return;
    store.setState(clampDashboardStateScroll(replaceSnapshot(store.getState(), loaded)));
  } catch (error: unknown) {
    if (!isActive()) return;
    addToast(store, safeErrorToToast(toSafeError(error)));
    store.setState({ loading: false });
  }
}

async function reconcileSnapshot(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  reason: string,
): Promise<void> {
  try {
    const loaded = await service.reconcile(reason);
    store.setState(
      clampDashboardStateScroll(
        addTuiToast(replaceSnapshot(store.getState(), loaded), {
          kind: "success",
          message: "observer.reconcile refreshed",
        }),
      ),
    );
  } catch (error: unknown) {
    addToast(store, safeErrorToToast(toSafeError(error)));
    store.setState({ loading: false });
  }
}

async function dispatchCommand(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  command: WosmCommand,
): Promise<void> {
  try {
    const receipt = await service.dispatch(command);
    const rejectedToast = rejectedCommandToast(command, receipt);
    if (rejectedToast !== undefined) {
      addToast(store, rejectedToast);
      return;
    }
    addToast(store, queuedCommandToast(command, receipt));
  } catch (error: unknown) {
    addToast(store, safeErrorToToast(toSafeError(error)));
  }
}

async function dispatchCommandAndWaitForCompletion(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  command: WosmCommand,
): Promise<boolean> {
  try {
    const receipt = await service.dispatch(command);
    const rejectedToast = rejectedCommandToast(command, receipt);
    if (rejectedToast !== undefined) {
      addToast(store, rejectedToast);
      return false;
    }

    const completion = await service.waitForCommandCompletion(receipt.commandId);
    if (completion.status === "succeeded") {
      return true;
    }
    addToast(store, safeErrorToToast(completion.error));
    return false;
  } catch (error: unknown) {
    addToast(store, safeErrorToToast(toSafeError(error)));
    return false;
  }
}

function shouldUseFocusLifecycle(
  command: WosmCommand,
  runtime: Pick<
    RuntimeOptions,
    "exitOnFocusSuccess" | "persistentPopup" | "resolveFocusOrigin" | "onFocusSuccess"
  >,
): command is Extract<WosmCommand, { type: "terminal.focus" }> {
  return (
    command.type === "terminal.focus" &&
    (runtime.exitOnFocusSuccess ||
      runtime.persistentPopup ||
      runtime.resolveFocusOrigin !== undefined ||
      runtime.onFocusSuccess !== undefined)
  );
}

async function dispatchFocusWithLifecycle(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  runtime: RuntimeOptions,
): Promise<void> {
  let focusCommand: Extract<WosmCommand, { type: "terminal.focus" }>;
  try {
    focusCommand = await withResolvedFocusOrigin(command, runtime);
  } catch (error: unknown) {
    addToast(store, safeErrorToToast(toSafeError(error)));
    return;
  }

  const waitsForCompletion =
    runtime.exitOnFocusSuccess || runtime.persistentPopup || runtime.onFocusSuccess !== undefined;
  if (!waitsForCompletion) {
    await dispatchCommand(store, service, focusCommand);
    return;
  }

  const succeeded = await dispatchCommandAndWaitForCompletion(store, service, focusCommand);
  if (!succeeded) {
    return;
  }

  if (runtime.onFocusSuccess !== undefined) {
    try {
      await runtime.onFocusSuccess();
    } catch (error: unknown) {
      addToast(store, safeErrorToToast(toSafeError(error)));
    }
  }

  if (runtime.exitOnFocusSuccess && !runtime.persistentPopup) {
    runtime.onExit?.(0);
  }
}

async function dismissPersistentPopup(
  store: StoreApi<TuiStore>,
  onDismiss: () => Promise<void>,
): Promise<void> {
  try {
    await onDismiss();
  } catch (error: unknown) {
    addToast(store, safeErrorToToast(toSafeError(error)));
  }
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

function rejectedCommandToast(command: WosmCommand, receipt: CommandReceipt): TuiToast | undefined {
  const receiptError = receipt.error;
  if (!receipt.accepted && receiptError !== undefined) {
    return safeErrorToToast(receiptError);
  }
  if (!receipt.accepted) {
    return {
      kind: "error",
      message: `${command.type} was rejected.`,
    };
  }
  return undefined;
}

function queuedCommandToast(command: WosmCommand, receipt: CommandReceipt): TuiToast {
  return {
    kind: "success",
    message: `${command.type} queued`,
    commandId: receipt.commandId,
    ...(receipt.traceId === undefined ? {} : { traceId: receipt.traceId }),
  };
}

function addToast(store: StoreApi<TuiStore>, toast: TuiToast): void {
  store.setState(addTuiToast(store.getState(), toast));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
