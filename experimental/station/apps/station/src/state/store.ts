import {
  MAIN_PANE_ID,
  type DialogId,
  type FocusTarget,
  type OverlayId,
  type PaneId,
  type PaneRecord,
  type PaneRole,
  type PaneSplitDirection,
  type StationState,
} from "./types.js";

export type CreatePaneOptions = {
  split?: {
    anchorPaneId: PaneId;
    direction: PaneSplitDirection;
  };
  /** Defaults to `"shell"`; the agent open-pane path passes `"primary-agent"`. */
  role?: PaneRole;
};

export type StationStoreActions = {
  createPane(paneId: PaneId, options?: CreatePaneOptions): void;
  /**
   * Record an already-created pane as a worktree session's primary agent: set
   * the pane record's role to `"primary-agent"` and map the worktree to it.
   * Orthogonal to focus/overlay (does not touch either); a non-member pane or
   * an already-recorded pair is a same-ref no-op.
   */
  setPrimaryAgent(worktreeId: string, paneId: PaneId): void;
  closePane(paneId: PaneId): void;
  /**
   * Make an existing pane the active one, overlay-aware. The reuse half of the
   * WOSM "open a shell here" affordance: a deterministic pane id that is
   * already a member re-surfaces its running shell instead of spawning a
   * second one. Like createPane it leaves focus on an open overlay (queuing
   * the pane as the return target) rather than stealing it.
   */
  revealPane(paneId: PaneId): void;
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
    workspace: {
      panes: [{ id: paneId, split: null, role: "shell" }],
      activePaneId: paneId,
      primaryAgentPaneByWorktree: {},
    },
    input: {
      focus: { kind: "pane", paneId },
      activeOverlay: null,
      overlayReturnFocus: null,
      dialogStack: [],
    },
  };
}

function hasPane(panes: readonly PaneRecord[], paneId: PaneId): boolean {
  return panes.some((pane) => pane.id === paneId);
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
 * Make `paneId` the active pane, respecting overlay ownership of focus. With
 * no overlay open this is the historical create/focus behavior: the pane
 * becomes active and focused. With an overlay open the overlay keeps focus and
 * the pane is recorded as `overlayReturnFocus`, so closing the overlay lands on
 * the freshly opened/revealed shell rather than the pane that was active when
 * the overlay opened. Returns the same reference when nothing changes so no-op
 * reveals do not notify.
 */
function withActivePane(state: StationState, paneId: PaneId): StationState {
  const workspace =
    state.workspace.activePaneId === paneId
      ? state.workspace
      : { ...state.workspace, activePaneId: paneId };
  if (state.input.activeOverlay !== null) {
    const returnFocus = state.input.overlayReturnFocus;
    const returnMatches = returnFocus?.kind === "pane" && returnFocus.paneId === paneId;
    if (workspace === state.workspace && returnMatches) {
      return state;
    }
    return {
      ...state,
      workspace,
      input: { ...state.input, overlayReturnFocus: { kind: "pane", paneId } },
    };
  }
  const focus = state.input.focus;
  const focusMatches = focus.kind === "pane" && focus.paneId === paneId;
  if (workspace === state.workspace && focusMatches) {
    return state;
  }
  return {
    ...state,
    workspace,
    input: { ...state.input, focus: { kind: "pane", paneId } },
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
      // A pane record is created once; the runtime PtyRegistry owns the live
      // process for the id. Creating a new pane makes it active and focused
      // (or, under an open overlay, the overlay's pending return target). The
      // record carries its role (default "shell") and optional split metadata.
      createPane: (paneId, options) => {
        if (hasPane(state.workspace.panes, paneId)) {
          return;
        }
        const split = options?.split;
        if (split !== undefined && !hasPane(state.workspace.panes, split.anchorPaneId)) {
          return;
        }
        const record: PaneRecord = {
          id: paneId,
          split: split ?? null,
          role: options?.role ?? "shell",
        };
        const appended: StationState = {
          ...state,
          workspace: { ...state.workspace, panes: [...state.workspace.panes, record] },
        };
        setState(withActivePane(appended, paneId));
      },
      // Role bookkeeping only: flips an existing pane's record role to
      // "primary-agent" and maps the worktree to it so a later row-click
      // re-finds it. Deliberately leaves focus/overlay to the open-pane chain
      // (createPane/revealPane already placed the pane), so withActivePane's
      // invariants are untouched.
      setPrimaryAgent: (worktreeId, paneId) => {
        const record = state.workspace.panes.find((pane) => pane.id === paneId);
        if (record === undefined) {
          return;
        }
        if (
          record.role === "primary-agent" &&
          state.workspace.primaryAgentPaneByWorktree[worktreeId] === paneId
        ) {
          return;
        }
        setState({
          ...state,
          workspace: {
            ...state.workspace,
            panes: state.workspace.panes.map((pane) =>
              pane.id === paneId ? { ...pane, role: "primary-agent" } : pane,
            ),
            primaryAgentPaneByWorktree: {
              ...state.workspace.primaryAgentPaneByWorktree,
              [worktreeId]: paneId,
            },
          },
        });
      },
      // Open-or-focus reuse: surface an already-created pane. Overlay-aware via
      // the same helper createPane uses, so revealing under the WOSM overlay
      // queues the pane as the return focus instead of yanking it forward.
      revealPane: (paneId) => {
        if (!hasPane(state.workspace.panes, paneId)) {
          return;
        }
        setState(withActivePane(state, paneId));
      },
      // Removing a pane record retargets the active pane and any focus that
      // pointed at it to a survivor (or the standard fallback when none remain).
      // The registry disposes the live process separately, off this state.
      closePane: (paneId) => {
        if (!hasPane(state.workspace.panes, paneId)) {
          return;
        }
        const panes = state.workspace.panes
          .filter((pane) => pane.id !== paneId)
          .map((pane) => (pane.split?.anchorPaneId === paneId ? { ...pane, split: null } : pane));
        const activePaneId =
          state.workspace.activePaneId === paneId
            ? (panes[panes.length - 1]?.id ?? null)
            : state.workspace.activePaneId;
        // Drop any worktree→pane mapping pointing at the removed pane (its role
        // lives on the record, so it is gone with the filter above). No
        // auto-promote: a closed primary agent just leaves the worktree without
        // one (relaunch-on-re-click is the deferred Path-A follow-up).
        const primaryAgentPaneByWorktree = Object.fromEntries(
          Object.entries(state.workspace.primaryAgentPaneByWorktree).filter(
            ([, mappedPaneId]) => mappedPaneId !== paneId,
          ),
        );
        const workspace = { panes, activePaneId, primaryAgentPaneByWorktree };
        const focus: FocusTarget =
          state.input.focus.kind === "pane" && state.input.focus.paneId === paneId
            ? activePaneId !== null
              ? { kind: "pane", paneId: activePaneId }
              : fallbackFocus({ ...state, workspace })
            : state.input.focus;
        // A pane queued as the overlay's return target (withActivePane records
        // this for an under-overlay create/reveal) must not survive the pane's
        // removal, or closeOverlay would restore focus to a gone pane. Drop it
        // so closeOverlay falls back to the active pane instead.
        const overlayReturnFocus: FocusTarget | null =
          state.input.overlayReturnFocus?.kind === "pane" &&
          state.input.overlayReturnFocus.paneId === paneId
            ? null
            : state.input.overlayReturnFocus;
        setState({ ...state, workspace, input: { ...state.input, focus, overlayReturnFocus } });
      },
      focusPane: (paneId) => {
        if (!hasPane(state.workspace.panes, paneId)) {
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
