import {
  MAIN_PANE_ID,
  type DialogId,
  type FocusTarget,
  type OverlayId,
  type PaneId,
  type StationState,
} from "./types.js";

export type StationStoreActions = {
  focusPane(paneId: PaneId): void;
  openOverlay(overlayId: OverlayId): void;
  closeOverlay(): void;
  toggleOverlay(overlayId: OverlayId): void;
  pushDialog(dialogId: DialogId): void;
  popDialog(): void;
};

export type StationStore = {
  getState(): StationState;
  subscribe(listener: () => void): () => void;
  actions: StationStoreActions;
};

export type StationStoreOptions = {
  initialPaneId?: PaneId;
};

function initialState(paneId: PaneId): StationState {
  return {
    workspace: { panes: [paneId], activePaneId: paneId },
    input: {
      focus: { kind: "pane", paneId },
      activeOverlay: null,
      overlayReturnFocus: null,
      dialogStack: [],
    },
  };
}

/** Focus to land on when nothing more specific is recorded. */
function fallbackFocus(state: StationState): FocusTarget {
  if (state.workspace.activePaneId !== null) {
    return { kind: "pane", paneId: state.workspace.activePaneId };
  }
  return { kind: "header", region: "title" };
}

function openOverlayState(state: StationState, overlayId: OverlayId): StationState {
  if (state.input.activeOverlay === overlayId) {
    return state;
  }
  return {
    ...state,
    input: {
      ...state.input,
      activeOverlay: overlayId,
      // Only pane focus is worth restoring; anything else falls back to the
      // active pane when the overlay closes.
      overlayReturnFocus: state.input.focus.kind === "pane" ? state.input.focus : null,
      focus: { kind: "overlay", overlayId },
    },
  };
}

function closeOverlayState(state: StationState): StationState {
  if (state.input.activeOverlay === null) {
    return state;
  }
  return {
    ...state,
    input: {
      ...state.input,
      activeOverlay: null,
      overlayReturnFocus: null,
      focus: state.input.overlayReturnFocus ?? fallbackFocus(state),
    },
  };
}

/**
 * The hand-rolled vanilla coordination store (subscribe/getState +
 * useSyncExternalStore on the React side). The store owns cross-app
 * coordination state only: never process handles, terminal buffers, or
 * renderer refs - those stay in the runtime registries.
 *
 * No module-level singleton: main.tsx owns the instance so HMR recreates
 * store, renderer, and input runtime together, and tests get a fresh store
 * each.
 */
export function createStationStore(options?: StationStoreOptions): StationStore {
  let state = initialState(options?.initialPaneId ?? MAIN_PANE_ID);
  const listeners = new Set<() => void>();

  // Reducers return the same reference for no-op actions; setState only
  // notifies on reference change, so no-op actions never re-render.
  function setState(next: StationState): void {
    if (next === state) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions: {
      focusPane: (paneId) => {
        if (!state.workspace.panes.includes(paneId)) {
          return;
        }
        const focus = state.input.focus;
        if (focus.kind === "pane" && focus.paneId === paneId && state.workspace.activePaneId === paneId) {
          return;
        }
        setState({
          workspace: { ...state.workspace, activePaneId: paneId },
          input: { ...state.input, focus: { kind: "pane", paneId } },
        });
      },
      openOverlay: (overlayId) => {
        setState(openOverlayState(state, overlayId));
      },
      closeOverlay: () => {
        setState(closeOverlayState(state));
      },
      // Self-contained so route-then-execute never reads stale overlay state.
      toggleOverlay: (overlayId) => {
        setState(
          state.input.activeOverlay === overlayId
            ? closeOverlayState(state)
            : openOverlayState(state, overlayId),
        );
      },
      pushDialog: (dialogId) => {
        setState({
          ...state,
          input: {
            ...state.input,
            dialogStack: [...state.input.dialogStack, dialogId],
            focus: { kind: "dialog", dialogId },
          },
        });
      },
      popDialog: () => {
        if (state.input.dialogStack.length === 0) {
          return;
        }
        const dialogStack = state.input.dialogStack.slice(0, -1);
        const topDialog = dialogStack[dialogStack.length - 1];
        const focus: FocusTarget =
          topDialog !== undefined
            ? { kind: "dialog", dialogId: topDialog }
            : state.input.activeOverlay !== null
              ? { kind: "overlay", overlayId: state.input.activeOverlay }
              : fallbackFocus(state);
        setState({
          ...state,
          input: { ...state.input, dialogStack, focus },
        });
      },
    },
  };
}
