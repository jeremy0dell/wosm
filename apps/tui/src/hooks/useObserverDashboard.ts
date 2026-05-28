import type { CommandReceipt, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyWosmEvent } from "../eventReducer.js";
import { safeErrorToToast, toSafeError } from "../services/errors.js";
import type { TuiObserverService, TuiToast } from "../services/types.js";
import { createInitialUiState, type TuiUiState } from "../uiState.js";

const EVENT_STREAM_RECONNECT_DELAY_MS = 100;

export type UseObserverDashboardOptions = {
  service: TuiObserverService;
  initialSnapshot?: WosmSnapshot;
  initialUiState?: TuiUiState;
  onEvent?: (event: WosmEvent) => void;
};

export type ObserverDashboardState = {
  snapshot: WosmSnapshot | undefined;
  lastEvent: WosmEvent | undefined;
  uiState: TuiUiState;
  loading: boolean;
  toasts: TuiToast[];
  setUiState(next: TuiUiState | ((current: TuiUiState) => TuiUiState)): void;
  addToast(toast: TuiToast): void;
  dispatchCommand(command: WosmCommand): Promise<void>;
  dispatchCommandWithReceipt(command: WosmCommand): Promise<CommandReceipt | undefined>;
  dispatchCommandAndWaitForCompletion(command: WosmCommand): Promise<boolean>;
  reconcile(reason?: string): Promise<void>;
  dismissToasts(): void;
};

export function useObserverDashboard(options: UseObserverDashboardOptions): ObserverDashboardState {
  const [snapshot, setSnapshot] = useState<WosmSnapshot | undefined>(options.initialSnapshot);
  const [lastEvent, setLastEvent] = useState<WosmEvent | undefined>();
  const [loading, setLoading] = useState(options.initialSnapshot === undefined);
  const [toasts, setToasts] = useState<TuiToast[]>([]);
  const [uiState, setUiState] = useState<TuiUiState>(
    options.initialUiState ?? createInitialUiState(),
  );

  useEffect(() => {
    let active = true;
    if (options.initialSnapshot !== undefined) {
      return () => {
        active = false;
      };
    }
    options.service
      .loadSnapshot()
      .then((loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [options.initialSnapshot, options.service]);

  useEffect(() => {
    let active = true;
    let currentIterator: AsyncIterator<WosmEvent> | undefined;
    let reportedSubscriptionError = false;

    const refreshSnapshot = async () => {
      try {
        const loaded = await options.service.loadSnapshot();
        if (!active) return;
        setSnapshot(loaded);
        setLoading(false);
      } catch (error: unknown) {
        if (!active) return;
        setToasts((toastState) => [...toastState, safeErrorToToast(toSafeError(error))]);
        setLoading(false);
      }
    };

    const handleEvent = (event: WosmEvent) => {
      reportedSubscriptionError = false;
      setSnapshot((current) => {
        if (current === undefined) {
          return current;
        }
        const result = applyWosmEvent(current, event);
        if (result.toasts.length > 0) {
          setToasts((toastState) => [...toastState, ...result.toasts]);
        }
        if (result.needsSnapshotRefresh) {
          void refreshSnapshot();
        }
        return result.snapshot;
      });
      setLastEvent(event);
      options.onEvent?.(event);
    };

    async function consumeEvents() {
      while (active) {
        try {
          currentIterator = options.service.subscribeEvents()[Symbol.asyncIterator]();
          for (;;) {
            const next = await currentIterator.next();
            if (!active) {
              return;
            }
            if (next.done) {
              await refreshSnapshot();
              break;
            }
            handleEvent(next.value);
          }
        } catch (error: unknown) {
          if (!active) return;
          if (!reportedSubscriptionError) {
            setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
            reportedSubscriptionError = true;
          }
          await refreshSnapshot();
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
  }, [options.onEvent, options.service]);

  const dispatchCommandWithReceipt = useCallback(
    async (command: WosmCommand): Promise<CommandReceipt | undefined> => {
      try {
        const receipt = await options.service.dispatch(command);
        const receiptError = receipt.error;
        if (!receipt.accepted && receiptError !== undefined) {
          setToasts((current) => [...current, safeErrorToToast(receiptError)]);
          return receipt;
        }
        if (!receipt.accepted) {
          setToasts((current) => [
            ...current,
            {
              kind: "error",
              message: `${command.type} was rejected.`,
            },
          ]);
          return receipt;
        }
        setToasts((current) => [
          ...current,
          {
            kind: "success",
            message: `${command.type} queued`,
            commandId: receipt.commandId,
            ...(receipt.traceId === undefined ? {} : { traceId: receipt.traceId }),
          },
        ]);
        return receipt;
      } catch (error: unknown) {
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
        return undefined;
      }
    },
    [options.service],
  );

  const dispatchCommand = useCallback(
    async (command: WosmCommand) => {
      await dispatchCommandWithReceipt(command);
    },
    [dispatchCommandWithReceipt],
  );

  const dispatchCommandAndWaitForCompletion = useCallback(
    async (command: WosmCommand): Promise<boolean> => {
      try {
        const receipt = await options.service.dispatch(command);
        const receiptError = receipt.error;
        if (!receipt.accepted && receiptError !== undefined) {
          setToasts((current) => [...current, safeErrorToToast(receiptError)]);
          return false;
        }
        if (!receipt.accepted) {
          setToasts((current) => [
            ...current,
            {
              kind: "error",
              message: `${command.type} was rejected.`,
            },
          ]);
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
      lastEvent,
      uiState,
      loading,
      toasts,
      setUiState,
      addToast,
      dispatchCommand,
      dispatchCommandWithReceipt,
      dispatchCommandAndWaitForCompletion,
      reconcile,
      dismissToasts,
    }),
    [
      addToast,
      dismissToasts,
      dispatchCommand,
      dispatchCommandWithReceipt,
      dispatchCommandAndWaitForCompletion,
      loading,
      lastEvent,
      reconcile,
      snapshot,
      toasts,
      uiState,
    ],
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
