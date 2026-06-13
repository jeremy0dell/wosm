export type PaneId = string;
export type OverlayId = string;
export type DialogId = string;

export const MAIN_PANE_ID: PaneId = "pane-main";
export const WOSM_OVERLAY_ID: OverlayId = "wosm";

/**
 * Deterministic pane ids for the WOSM "open a shell here" affordance. The id
 * is derived from the worktree/project identity so re-triggering the same
 * target resolves to the same pane (open-or-focus), not a second shell. The
 * convention lives here so both the resolver that builds ids and any future
 * consumer share one source of truth.
 */
export function worktreePaneId(worktreeId: string): PaneId {
  return `pane-wt-${worktreeId}`;
}

export function projectPaneId(projectId: string): PaneId {
  return `pane-proj-${projectId}`;
}

export type PaneSplitDirection = "right" | "below";

export type PaneRecord = {
  id: PaneId;
  split: null | {
    anchorPaneId: PaneId;
    direction: PaneSplitDirection;
  };
};

export type HeaderRegion = "tabs" | "island" | "title";

/**
 * The single focus vocabulary for the app. Focus is a store value mutated
 * only by explicit actions; OpenTUI's own focusable/focus() system is
 * deliberately unused for panes so there is exactly one focus system.
 * The header arm exists for completeness but nothing produces it in
 * Phase 1: header clicks route to overlay toggling without taking focus.
 */
export type FocusTarget =
  | { kind: "header"; region: HeaderRegion }
  | { kind: "pane"; paneId: PaneId }
  | { kind: "overlay"; overlayId: OverlayId }
  | { kind: "dialog"; dialogId: DialogId };

export type WorkspaceSlice = {
  panes: readonly PaneRecord[];
  activePaneId: PaneId | null;
};

export type InputSlice = {
  focus: FocusTarget;
  activeOverlay: OverlayId | null;
  /** Focus to restore when the overlay closes; only pane focus is recorded. */
  overlayReturnFocus: FocusTarget | null;
  dialogStack: readonly DialogId[];
};

export type StationState = {
  workspace: WorkspaceSlice;
  input: InputSlice;
};
