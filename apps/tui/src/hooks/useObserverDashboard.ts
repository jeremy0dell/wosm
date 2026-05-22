import type { WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyWosmEvent } from "../eventReducer.js";
import { safeErrorToToast, toSafeError } from "../services/errors.js";
import type { TuiObserverService, TuiToast } from "../services/types.js";
import { createInitialUiState, type TuiUiState } from "../uiState.js";

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
    const iterator = options.service.subscribeEvents()[Symbol.asyncIterator]();

    async function consumeEvents() {
      try {
        for (;;) {
          const next = await iterator.next();
          if (!active || next.done) {
            return;
          }
          setSnapshot((current) => {
            if (current === undefined) {
              return current;
            }
            const result = applyWosmEvent(current, next.value);
            if (result.toasts.length > 0) {
              setToasts((toastState) => [...toastState, ...result.toasts]);
            }
            if (result.needsSnapshotRefresh) {
              void options.service
                .loadSnapshot()
                .then((loaded) => {
                  if (active) setSnapshot(loaded);
                })
                .catch((error: unknown) => {
                  if (!active) return;
                  setToasts((toastState) => [...toastState, safeErrorToToast(toSafeError(error))]);
                });
            }
            return result.snapshot;
          });
        }
      } catch (error: unknown) {
        if (!active) return;
        setToasts((current) => [...current, safeErrorToToast(toSafeError(error))]);
      }
    }

    void consumeEvents();
    return () => {
      active = false;
      void iterator.return?.();
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
            message: `${command.type} accepted`,
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
      dismissToasts,
    }),
    [addToast, dismissToasts, dispatchCommand, loading, snapshot, toasts, uiState],
  );
}
