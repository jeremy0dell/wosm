import { WOSM_OVERLAY_ID, type PaneId, type StationState } from "./types.js";

// Components must select scalars (useSyncExternalStore compares snapshots
// with Object.is); getState() returns the immutable root for everyone else.

export function selectWosmOverlayVisible(state: StationState): boolean {
  return state.input.activeOverlay === WOSM_OVERLAY_ID;
}

export function selectActivePaneId(state: StationState): PaneId | null {
  return state.workspace.activePaneId;
}

export function selectFocusedPaneId(state: StationState): PaneId | null {
  return state.input.focus.kind === "pane" ? state.input.focus.paneId : null;
}

export function selectDialogActive(state: StationState): boolean {
  return state.input.dialogStack.length > 0;
}
