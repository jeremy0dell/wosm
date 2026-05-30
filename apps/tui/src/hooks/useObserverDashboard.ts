import type { CommandReceipt, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applyWosmEvent } from "../eventReducer/eventReducer.js";
import { safeErrorToToast, toSafeError } from "../services/errors/errors.js";
import type { TuiObserverService, TuiToast } from "../services/types.js";
import { createInitialUiState, type TuiUiState } from "../uiState/uiState.js";

const EVENT_STREAM_RECONNECT_DELAY_MS = 100;

export type UseObserverDashboardOptions = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  initialUiState?: TuiUiState;
  onEvent?: (event: WosmEvent) => void;
};

export type ObserverDashboardState = {
  snapshot: WosmSnapshot | undefined;
  uiState: TuiUiState;
  loading: boolean;
  toasts: TuiToast[];
  setUiState(next: TuiUiState | ((current: TuiUiState) => TuiUiState)): void;
  addToast(toast: TuiToast): void;
  dispatchCommand(command: WosmCommand): Promise<void>;
  dispatchCommandAndWaitForCompletion(command: WosmCommand): Promise<boolean>;
  reconcile(reason?: string): Promise<void>;
  dismissToasts(): void;
};

export function useObserverDashboard(options: UseObserverDashboardOptions): ObserverDashboardState {
  const [snapshot, setSnapshot] = useState<WosmSnapshot | undefined>(options.initialSnapshot);
  const [loading, setLoading] = useState(options.initialSnapshot === undefined);
  const [toasts, setToasts] = useState<TuiToast[]>([]);
  const [uiState, setUiState] = useState<TuiUiState>(
    options.initialUiState ?? createInitialUiState(),
  );
  const dashboardState = useMemo(
    () => ({
      setSnapshot,
      setLoading,
      setToasts,
    }),
    [],
  );

  useInitialSnapshotLoad(options, dashboardState);
  useObserverEventStream(options, dashboardState);

  const dispatchCommand = useCallback(
    async (command: WosmCommand): Promise<void> => {
      try {
        const receipt = await options.service.dispatch(command);
        const rejectedToast = rejectedCommandToast(command, receipt);
        if (rejectedToast !== undefined) {
          setToasts((current) => [...current, rejectedToast]);
          return;
        }
        setToasts((current) => [...current, queuedCommandToast(command, receipt)]);
      } catch (error: unknown) {
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
      }
    },
    [options.service],
  );

  const dispatchCommandAndWaitForCompletion = useCallback(
    async (command: WosmCommand): Promise<boolean> => {
      try {
        const receipt = await options.service.dispatch(command);
        const rejectedToast = rejectedCommandToast(command, receipt);
        if (rejectedToast !== undefined) {
          setToasts((current) => [...current, rejectedToast]);
          return false;
        }

        const completion = await options.service.waitForCommandCompletion(receipt.commandId);
        if (completion.status === "succeeded") {
          return true;
        }
        setToasts((current) => [...current, safeErrorToToast(completion.error)]);
        return false;
      } catch (error: unknown) {
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
        return false;
      }
    },
    [options.service],
  );

  const reconcile = useCallback(
    async (reason?: string) => {
      try {
        const loaded = await options.service.reconcile(reason);
        setSnapshot(loaded);
        setLoading(false);
        setToasts((current) => [
          ...current,
          {
            kind: "success",
            message: "observer.reconcile refreshed",
          },
        ]);
      } catch (error: unknown) {
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
        setLoading(false);
      }
    },
    [options.service],
  );

  const addToast = useCallback((toast: TuiToast) => {
    setToasts((current) => [...current, toast]);
  }, []);

  const dismissToasts = useCallback(() => setToasts([]), []);

  return useMemo(
    () => ({
      snapshot,
      uiState,
      loading,
      toasts,
      setUiState,
      addToast,
      dispatchCommand,
      dispatchCommandAndWaitForCompletion,
      reconcile,
      dismissToasts,
    }),
    [
      addToast,
      dismissToasts,
      dispatchCommand,
      dispatchCommandAndWaitForCompletion,
      loading,
      reconcile,
      snapshot,
      toasts,
      uiState,
    ],
  );
}

type DashboardStateSetters = {
  setSnapshot: Dispatch<SetStateAction<WosmSnapshot | undefined>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setToasts: Dispatch<SetStateAction<TuiToast[]>>;
};

function useInitialSnapshotLoad(
  options: UseObserverDashboardOptions,
  state: DashboardStateSetters,
): void {
  useEffect(() => {
    let active = true;
    if (options.initialSnapshot !== undefined) {
      return () => {
        active = false;
      };
    }
    void refreshSnapshot(options.service, state, () => active);
    return () => {
      active = false;
    };
  }, [options.initialSnapshot, options.service, state]);
}

function useObserverEventStream(
  options: UseObserverDashboardOptions,
  state: DashboardStateSetters,
): void {
  useEffect(() => {
    let active = true;
    let currentIterator: AsyncIterator<WosmEvent> | undefined;
    let reportedSubscriptionError = false;

    const refreshCurrentSnapshot = async () => {
      await refreshSnapshot(options.service, state, () => active);
    };

    const handleEvent = (event: WosmEvent) => {
      reportedSubscriptionError = false;
      state.setSnapshot((current) => {
        if (current === undefined) {
          return current;
        }
        const result = applyWosmEvent(current, event);
        if (result.toasts.length > 0) {
          state.setToasts((toastState) => [...toastState, ...result.toasts]);
        }
        if (result.needsSnapshotRefresh) {
          void refreshCurrentSnapshot();
        }
        return result.snapshot;
      });
      options.onEvent?.(event);
    };

    async function consumeEvents() {
      while (active) {
        try {
          // The event stream is long-lived; ending it is a reconnect signal, not terminal state.
          currentIterator = options.service.subscribeEvents()[Symbol.asyncIterator]();
          await consumeCurrentSubscription(currentIterator, () => active, handleEvent);
          if (active) {
            await refreshCurrentSnapshot();
          }
        } catch (error: unknown) {
          if (!active) return;
          if (!reportedSubscriptionError) {
            state.setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
            reportedSubscriptionError = true;
          }
          await refreshCurrentSnapshot();
        } finally {
          const iterator = currentIterator;
          currentIterator = undefined;
          // Returning the iterator releases the protocol subscription when reconnecting or unmounting.
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
  }, [options.onEvent, options.service, state]);
}

async function refreshSnapshot(
  service: TuiObserverService,
  state: DashboardStateSetters,
  isActive: () => boolean,
): Promise<void> {
  try {
    const loaded = await service.loadSnapshot();
    if (!isActive()) return;
    state.setSnapshot(loaded);
    state.setLoading(false);
  } catch (error: unknown) {
    if (!isActive()) return;
    state.setToasts((toastState) => [...toastState, safeErrorToToast(toSafeError(error))]);
    state.setLoading(false);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
