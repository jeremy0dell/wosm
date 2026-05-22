import type { WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
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
};

export type ObserverDashboardState = {
  snapshot: WosmSnapshot | undefined;
  uiState: TuiUiState;
  loading: boolean;
  toasts: TuiToast[];
  setUiState(next: TuiUiState | ((current: TuiUiState) => TuiUiState)): void;
  addToast(toast: TuiToast): void;
  dispatchCommand(command: WosmCommand): Promise<void>;
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
  }, [options.service]);

  const dispatchCommand = useCallback(
    async (command: WosmCommand) => {
      try {
        const receipt = await options.service.dispatch(command);
        const receiptError = receipt.error;
        if (!receipt.accepted && receiptError !== undefined) {
          setToasts((current) => [...current, safeErrorToToast(receiptError)]);
          return;
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
      } catch (error: unknown) {
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
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
      reconcile,
      dismissToasts,
    }),
    [addToast, dismissToasts, dispatchCommand, loading, reconcile, snapshot, toasts, uiState],
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
