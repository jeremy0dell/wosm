import type { WosmClientConnectionState } from "@wosm/client";
import type { WosmSnapshot } from "@wosm/contracts";
import type { StoreApi } from "zustand/vanilla";
import { clampDashboardStateScroll } from "./dashboardScroll.js";
import { replaceSnapshot } from "./screen.js";
import type { TuiStore } from "./store.js";
import { OBSERVER_RECOVERY_TOAST_THRESHOLD_MS } from "./timing.js";
import { addTuiToast } from "./toasts.js";
import type { TuiObserverConnectionStatus, TuiState } from "./types.js";

export type TuiSnapshotSourceState = {
  snapshot?: WosmSnapshot;
  connection: WosmClientConnectionState;
};

export interface TuiSnapshotSource {
  getState(): TuiSnapshotSourceState;
  subscribe(listener: () => void): () => void;
}

export function attachTuiSnapshotSource(
  store: StoreApi<TuiStore>,
  source: TuiSnapshotSource,
): () => void {
  const apply = (): void => {
    store.setState(applySnapshotSourceState(store.getState(), source.getState(), Date.now()));
  };
  apply();
  return source.subscribe(apply);
}

/**
 * Mirrors the runtime-hook path for callers that already own a subscribable
 * snapshot source: fresh snapshots replace and clamp state, while recovery
 * after a long outage emits the same user-facing reconnection toast.
 */
export function applySnapshotSourceState(
  state: TuiState,
  sourceState: TuiSnapshotSourceState,
  nowMs: number,
): TuiState {
  let next = state;
  if (sourceState.snapshot !== undefined && sourceState.snapshot !== state.snapshot) {
    next = clampDashboardStateScroll(replaceSnapshot(next, sourceState.snapshot));
  }
  return applyConnectionState(next, sourceState.connection, nowMs);
}

function applyConnectionState(
  state: TuiState,
  connection: WosmClientConnectionState,
  nowMs: number,
): TuiState {
  switch (connection.state) {
    case "idle":
    case "loading":
      return state;
    case "connected":
      return observerConnectedState(state, nowMs);
    case "reconnecting":
    case "displayOnly":
    case "halted": {
      const status: TuiObserverConnectionStatus =
        state.snapshot === undefined
          ? { state: "reconnecting", since: connection.since, lastError: connection.lastError }
          : { state: "displayOnly", since: connection.since, lastError: connection.lastError };
      return {
        ...state,
        loading: state.snapshot === undefined ? state.loading : false,
        observerConnectionStatus: status,
      };
    }
  }
}

function observerConnectedState(state: TuiState, nowMs: number): TuiState {
  const previous = state.observerConnectionStatus;
  if (previous.state === "connected") {
    return state;
  }
  let next: TuiState = {
    ...state,
    observerConnectionStatus: { state: "connected" },
  };
  if (nowMs - previous.since > OBSERVER_RECOVERY_TOAST_THRESHOLD_MS) {
    next = addTuiToast(
      next,
      {
        kind: "success",
        message: "Observer reconnected.",
      },
      nowMs,
    );
  }
  return next;
}
