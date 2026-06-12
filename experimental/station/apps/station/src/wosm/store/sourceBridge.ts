// Station replacement for apps/tui's observerBridge: the TUI wires
// @wosm/client runtime hooks straight into its store, while Station already
// owns a subscribable source boundary (StationWosmStateSource, mock or live
// decided in one factory). This bridge maps that source's state into the
// ported TuiState — snapshot replacement plus the connection-status
// presentation the TUI's bridge derived from runtime hooks.
import type { WosmClientConnectionState } from "@wosm/client";
import type { StoreApi } from "zustand/vanilla";
import type { StationWosmState, StationWosmStateSource } from "../../sources/types.js";
import { clampDashboardStateScroll } from "../ported/state/dashboardScroll.js";
import { replaceSnapshot } from "../ported/state/screen.js";
import { OBSERVER_RECOVERY_TOAST_THRESHOLD_MS } from "../ported/state/timing.js";
import { addTuiToast } from "../ported/state/toasts.js";
import type { TuiStore } from "../ported/state/store.js";
import type { TuiObserverConnectionStatus, TuiState } from "../ported/state/types.js";

export function attachStationSource(
  store: StoreApi<TuiStore>,
  source: StationWosmStateSource,
): () => void {
  const apply = (): void => {
    store.setState(applySourceState(store.getState(), source.getState(), Date.now()));
  };
  apply();
  return source.subscribe(apply);
}

/**
 * Pure state mapping, exported for tests. Mirrors the upstream bridge's
 * semantics: a fresh snapshot replaces and re-clamps; connection failures
 * present as `reconnecting` until a snapshot exists and `displayOnly` after
 * (the source keeps the last good snapshot through reconnects); recovering
 * after a long outage adds the same "Observer reconnected." toast.
 * `halted` has no TUI equivalent and presents like displayOnly/reconnecting —
 * the lastError carries the explanation.
 */
export function applySourceState(
  state: TuiState,
  sourceState: StationWosmState,
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
