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

/**
 * The pane id for a worktree session's primary agent. A distinct prefix from
 * worktreePaneId so a worktree's agent pane never collides with its `[+sh]`
 * shell pane: a session can host both its agent and an explicit shell at once.
 */
export function agentWorktreePaneId(worktreeId: string): PaneId {
  return `pane-agent-wt-${worktreeId}`;
}

export function projectPaneId(projectId: string): PaneId {
  return `pane-proj-${projectId}`;
}

export type PaneSplitDirection = "right" | "below";

/**
 * What a pane is for. `"shell"` is the `[+sh]` plain shell (and the boot pane);
 * `"primary-agent"` is a worktree session's agent process. Role rides on the
 * pane record (not a parallel map) and is orthogonal to focus/active — it only
 * records intent so the agent can be re-found.
 */
export type PaneRole = "primary-agent" | "shell";

export type PaneRecord = {
  id: PaneId;
  split: null | {
    anchorPaneId: PaneId;
    direction: PaneSplitDirection;
  };
  role: PaneRole;
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
  /**
   * A worktree id → the pane hosting its primary agent. Recorded now as the
   * data model the deferred identity/reconciliation phase will read (dedup a
   * Station agent against the observer's session). It does NOT currently drive
   * open-or-focus reuse — that keys off the deterministic `agentWorktreePaneId`
   * being a `panes` member, derived independently of this map.
   */
  primaryAgentPaneByWorktree: Readonly<Record<string, PaneId>>;
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
