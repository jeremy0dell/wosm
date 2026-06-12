// ADAPTED from apps/tui/src/state/store.ts — see ../PROVENANCE.md.
// Station differences, kept surgical so the upstream diff stays reviewable:
// - The @wosm/client runtime + observer-bridge hooks are replaced by a
//   StationWosmStateSource subscription (../../store/sourceBridge.ts); the
//   source owns the live/mock decision and the client runtime.
// - reconcile goes through the injected ObserverService directly (Station's
//   stub until client plan PR 4) instead of the client runtime.
// - handleKey returns the transition meta (dismissPopup/exitCode) so the
//   overlay keymap layer can map it to a router outcome; the popup-dismiss
//   and exit effects themselves are executed by the router, not this store.
import type {
  CommandReceipt,
  TerminalFocusOrigin,
  WorktreeRow,
  WosmCommand,
  WosmSnapshot,
} from "@wosm/contracts";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { StationWosmStateSource } from "../../../sources/types.js";
import { attachStationSource } from "../../store/sourceBridge.js";
import { sessionForWorktreeRow } from "../selectors/selectors.js";
import { safeErrorToToast, toSafeError } from "../services/errors/errors.js";
import { createNodeFolderService, type TuiFolderService } from "../services/folderService.js";
import type { TuiObserverService, TuiToast } from "../services/types.js";
import { buildFocusCommand } from "./commandBuilders.js";
import { clampDashboardStateScroll } from "./dashboardScroll.js";
import type { TuiKey } from "./keys.js";
import {
  createTuiLocalOperationRunner,
  type TuiLocalOperationRunner,
} from "./operations/localOperationRunner.js";
import { prepareCommandForRuntime, withResolvedFocusOrigin } from "./operations/runtimeCommands.js";
import { createInitialTuiState, replaceSnapshot } from "./screen.js";
import { addTuiToast, expireTuiToasts, refreshActiveTuiToastExpiry } from "./toasts.js";
import { handleTuiKey, type TuiTransition } from "./transition.js";
import type { CreateInitialTuiStateOptions, TuiState } from "./types.js";

/** The transition facts the overlay keymap layer maps to a router outcome. */
export type TuiHandleKeyResult = {
  dismissPopup: boolean;
  exitCode?: number;
};

export type TuiStore = TuiState & {
  start(): () => void;
  handleKey(key: TuiKey): TuiHandleKeyResult;
  setTerminalRows(rows: number): void;
  dismissToasts(): void;
  expireToasts(nowMs?: number): void;
  refreshActiveToastExpiry(nowMs?: number): void;
};

export type TuiStoreOptions = {
  source: StationWosmStateSource;
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
  folderService?: TuiFolderService;
};

export function createTuiStore(options: TuiStoreOptions): StoreApi<TuiStore> {
  const runtime = createRuntimeOptions(options);
  const folderService = options.folderService ?? createNodeFolderService();
  let store: StoreApi<TuiStore>;
  const operations: TuiLocalOperationRunner = createTuiLocalOperationRunner({
    getStore: () => store,
    service: options.service,
    folderService,
    runtime,
    focusStartedAgentRow: async (snapshot, row) => {
      await dispatchFocusWithLifecycle(
        store,
        options.service,
        buildStartedAgentFocusCommand(snapshot, row),
        runtime,
      );
    },
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
    start: (): (() => void) => {
      return attachStationSource(store, options.source);
    },
    handleKey: (key): TuiHandleKeyResult => {
      const transition = handleTuiKey(get(), key, {
        cwd: folderService.cwd(),
        homeDir: folderService.homeDir(),
      });
      set(transition.state);
      void applyTransitionEffects(store, options.service, runtime, operations, transition);
      const result: TuiHandleKeyResult = { dismissPopup: transition.dismissPopup === true };
      if (transition.exitCode !== undefined) {
        result.exitCode = transition.exitCode;
      }
      return result;
    },
    setTerminalRows: (rows): void => {
      set(clampDashboardStateScroll({ ...get(), terminalRows: rows }));
    },
    dismissToasts: (): void => {
      set({ toasts: [] });
    },
    expireToasts: (nowMs = Date.now()): void => {
      set(expireTuiToasts(get(), nowMs));
    },
    refreshActiveToastExpiry: (nowMs = Date.now()): void => {
      set(refreshActiveTuiToastExpiry(get(), nowMs));
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

async function reconcileSnapshot(
  store: StoreApi<TuiStore>,
  service: TuiObserverService,
  reason: string,
): Promise<void> {
  try {
    // Upstream routes reconcile through the client runtime, whose refresh
    // hook applies the connected transition and recovery toast; here only
    // the snapshot lands — connection status stays the source bridge's to
    // own. When client plan PR 4 wires a real service, route reconcile
    // through the source/client runtime so the connected transition arrives
    // via the subscription (the stub service's reconcile always rejects, so
    // this success path is unreachable until then).
    const snapshot = await service.reconcile(reason);
    store.setState(clampDashboardStateScroll(replaceSnapshot(store.getState(), snapshot)));
    store.setState(
      addTuiToast(store.getState(), {
        kind: "success",
        message: "observer.reconcile refreshed",
      }),
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

function buildStartedAgentFocusCommand(
  snapshot: WosmSnapshot,
  row: WorktreeRow,
): Extract<WosmCommand, { type: "terminal.focus" }> {
  const session = sessionForWorktreeRow(row, snapshot.sessions);
  if (row.agent === undefined && session !== undefined) {
    return {
      type: "terminal.focus",
      payload: {
        sessionId: session.id,
      },
    };
  }
  return buildFocusCommand(row);
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
