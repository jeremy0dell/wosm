import { describe, expect, it } from "bun:test";
import { createStationStore } from "./store.js";
import { MAIN_PANE_ID, WOSM_OVERLAY_ID, type PaneRecord, type PaneRole } from "./types.js";

function createCountingStore() {
  const store = createStationStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  return { store, count: () => notifications };
}

function paneRecord(
  id: string,
  split: PaneRecord["split"] = null,
  role: PaneRole = "shell",
): PaneRecord {
  return { id, split, role };
}

describe("createStationStore", () => {
  it("boots with the main pane focused and no overlay or dialogs", () => {
    const store = createStationStore();
    const state = store.getState();
    expect(state.workspace.panes).toEqual([paneRecord(MAIN_PANE_ID)]);
    expect(state.workspace.activePaneId).toEqual(MAIN_PANE_ID);
    expect(state.input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
    expect(state.input.activeOverlay).toBeNull();
    expect(state.input.dialogStack).toEqual([]);
  });

  it("keeps getState reference-stable between actions and replaces it per change", () => {
    const store = createStationStore();
    const before = store.getState();
    expect(store.getState()).toBe(before);
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(store.getState()).not.toBe(before);
    const after = store.getState();
    expect(store.getState()).toBe(after);
  });

  it("ignores focusPane for unknown panes without notifying", () => {
    const { store, count } = createCountingStore();
    const before = store.getState();
    store.actions.focusPane("pane-unknown");
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(0);
  });

  it("does not notify when focusPane targets the already-focused pane", () => {
    const { store, count } = createCountingStore();
    store.actions.focusPane(MAIN_PANE_ID);
    expect(count()).toEqual(0);
  });

  it("createPane appends the pane and makes it active and focused", () => {
    const store = createStationStore();
    store.actions.createPane("pane-second");
    const state = store.getState();
    expect(state.workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-second"),
    ]);
    expect(state.workspace.activePaneId).toEqual("pane-second");
    expect(state.input.focus).toEqual({ kind: "pane", paneId: "pane-second" });
  });

  it("createPane records split metadata for a valid anchor", () => {
    const store = createStationStore();
    store.actions.createPane("pane-right", {
      split: { anchorPaneId: MAIN_PANE_ID, direction: "right" },
    });
    const state = store.getState();
    expect(state.workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-right", { anchorPaneId: MAIN_PANE_ID, direction: "right" }),
    ]);
    expect(state.workspace.activePaneId).toEqual("pane-right");
    expect(state.input.focus).toEqual({ kind: "pane", paneId: "pane-right" });
  });

  it("createPane is a silent no-op for a pane that already exists", () => {
    const { store, count } = createCountingStore();
    const before = store.getState();
    store.actions.createPane(MAIN_PANE_ID);
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(0);
  });

  it("createPane is a silent no-op when split metadata points at an unknown anchor", () => {
    const { store, count } = createCountingStore();
    const before = store.getState();
    store.actions.createPane("pane-orphan", {
      split: { anchorPaneId: "pane-missing", direction: "below" },
    });
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(0);
  });

  it("createPane keeps the existing record when a duplicate supplies new metadata", () => {
    const { store, count } = createCountingStore();
    store.actions.createPane("pane-right", {
      split: { anchorPaneId: MAIN_PANE_ID, direction: "right" },
    });
    const created = store.getState();
    const baseline = count();
    store.actions.createPane("pane-right", {
      split: { anchorPaneId: MAIN_PANE_ID, direction: "below" },
    });
    expect(store.getState()).toBe(created);
    expect(count()).toEqual(baseline);
    expect(store.getState().workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-right", { anchorPaneId: MAIN_PANE_ID, direction: "right" }),
    ]);
  });

  it("createPane under an open overlay queues the pane without stealing focus", () => {
    const store = createStationStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    store.actions.createPane("pane-shell");
    const state = store.getState();
    expect(state.workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-shell"),
    ]);
    expect(state.workspace.activePaneId).toEqual("pane-shell");
    // The overlay keeps focus; the new pane becomes the return target.
    expect(state.input.focus).toEqual({ kind: "overlay", overlayId: WOSM_OVERLAY_ID });
    expect(state.input.overlayReturnFocus).toEqual({ kind: "pane", paneId: "pane-shell" });
    // Closing the overlay lands on the queued pane, not the original.
    store.actions.closeOverlay();
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: "pane-shell" });
  });

  it("revealPane is overlay-aware: queues under an overlay, focuses without one", () => {
    const store = createStationStore();
    store.actions.createPane("pane-shell");
    store.actions.focusPane(MAIN_PANE_ID);
    // No overlay: revealPane focuses + activates like a plain switch.
    store.actions.revealPane("pane-shell");
    expect(store.getState().workspace.activePaneId).toEqual("pane-shell");
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: "pane-shell" });

    // Under an overlay: queue the return target, leave focus on the overlay.
    store.actions.focusPane(MAIN_PANE_ID);
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    store.actions.revealPane("pane-shell");
    const state = store.getState();
    expect(state.workspace.activePaneId).toEqual("pane-shell");
    expect(state.input.focus).toEqual({ kind: "overlay", overlayId: WOSM_OVERLAY_ID });
    expect(state.input.overlayReturnFocus).toEqual({ kind: "pane", paneId: "pane-shell" });
    store.actions.closeOverlay();
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: "pane-shell" });
  });

  it("revealPane is a silent no-op for unknown panes and for the already-active pane", () => {
    const { store, count } = createCountingStore();
    store.actions.revealPane("pane-unknown");
    expect(count()).toEqual(0);
    // MAIN is already active and focused with no overlay: nothing changes.
    const before = store.getState();
    store.actions.revealPane(MAIN_PANE_ID);
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(0);
  });

  it("revealPane under an overlay is a no-op once the pane is active and already queued", () => {
    const { store, count } = createCountingStore();
    store.actions.createPane("pane-shell"); // active + focus pane-shell (no overlay)
    store.actions.openOverlay(WOSM_OVERLAY_ID); // records overlayReturnFocus = pane-shell
    // pane-shell is active AND already the queued return target: nothing to do.
    const before = store.getState();
    const baseline = count();
    store.actions.revealPane("pane-shell");
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(baseline);
  });

  it("closePane drops an overlayReturnFocus that points at the removed pane", () => {
    const store = createStationStore();
    store.actions.createPane("pane-shell");
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(store.getState().input.overlayReturnFocus).toEqual({ kind: "pane", paneId: "pane-shell" });
    store.actions.closePane("pane-shell");
    expect(store.getState().input.overlayReturnFocus).toBeNull();
    // closeOverlay must land on a surviving pane, not the removed return target.
    store.actions.closeOverlay();
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("closePane clears split metadata that pointed at the removed pane", () => {
    const store = createStationStore();
    store.actions.createPane("pane-anchor");
    store.actions.createPane("pane-child", {
      split: { anchorPaneId: "pane-anchor", direction: "below" },
    });
    store.actions.closePane("pane-anchor");
    expect(store.getState().workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-child"),
    ]);
  });

  it("closePane removes the pane and retargets active + focus to a survivor", () => {
    const store = createStationStore();
    store.actions.createPane("pane-second");
    store.actions.closePane("pane-second");
    const state = store.getState();
    expect(state.workspace.panes).toEqual([paneRecord(MAIN_PANE_ID)]);
    expect(state.workspace.activePaneId).toEqual(MAIN_PANE_ID);
    expect(state.input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("closePane on a non-active pane leaves active and focus untouched", () => {
    const store = createStationStore();
    store.actions.createPane("pane-second");
    store.actions.focusPane(MAIN_PANE_ID);
    store.actions.closePane("pane-second");
    const state = store.getState();
    expect(state.workspace.panes).toEqual([paneRecord(MAIN_PANE_ID)]);
    expect(state.workspace.activePaneId).toEqual(MAIN_PANE_ID);
    expect(state.input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("preserves split metadata through focusPane and revealPane", () => {
    const store = createStationStore();
    store.actions.createPane("pane-right", {
      split: { anchorPaneId: MAIN_PANE_ID, direction: "right" },
    });
    store.actions.focusPane(MAIN_PANE_ID);
    store.actions.revealPane("pane-right");
    store.actions.focusPane(MAIN_PANE_ID);
    expect(store.getState().workspace.panes).toEqual([
      paneRecord(MAIN_PANE_ID),
      paneRecord("pane-right", { anchorPaneId: MAIN_PANE_ID, direction: "right" }),
    ]);
  });

  it("closePane of the last pane clears active and falls back off pane focus", () => {
    const store = createStationStore();
    store.actions.closePane(MAIN_PANE_ID);
    const state = store.getState();
    expect(state.workspace.panes).toEqual([]);
    expect(state.workspace.activePaneId).toBeNull();
    expect(state.input.focus).toEqual({ kind: "header", region: "title" });
  });

  it("closePane is a silent no-op for an unknown pane", () => {
    const { store, count } = createCountingStore();
    store.actions.closePane("pane-unknown");
    expect(count()).toEqual(0);
  });

  it("openOverlay records the pane focus and focuses the overlay", () => {
    const store = createStationStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    const state = store.getState();
    expect(state.input.activeOverlay).toEqual(WOSM_OVERLAY_ID);
    expect(state.input.focus).toEqual({ kind: "overlay", overlayId: WOSM_OVERLAY_ID });
    expect(state.input.overlayReturnFocus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("openOverlay is idempotent when the overlay is already active", () => {
    const { store, count } = createCountingStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    const opened = store.getState();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(store.getState()).toBe(opened);
    expect(count()).toEqual(1);
  });

  it("closeOverlay restores the recorded focus", () => {
    const store = createStationStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    store.actions.closeOverlay();
    const state = store.getState();
    expect(state.input.activeOverlay).toBeNull();
    expect(state.input.overlayReturnFocus).toBeNull();
    expect(state.input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("closeOverlay falls back to the active pane when nothing was recorded", () => {
    const store = createStationStore();
    store.actions.pushDialog("dialog-test");
    // Opening from dialog focus records nothing to restore.
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(store.getState().input.overlayReturnFocus).toBeNull();
    store.actions.closeOverlay();
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("closeOverlay without an open overlay is a silent no-op", () => {
    const { store, count } = createCountingStore();
    store.actions.closeOverlay();
    expect(count()).toEqual(0);
  });

  it("toggleOverlay round-trips back to the original focus", () => {
    const store = createStationStore();
    store.actions.toggleOverlay(WOSM_OVERLAY_ID);
    expect(store.getState().input.activeOverlay).toEqual(WOSM_OVERLAY_ID);
    store.actions.toggleOverlay(WOSM_OVERLAY_ID);
    const state = store.getState();
    expect(state.input.activeOverlay).toBeNull();
    expect(state.input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("pushDialog focuses the dialog and popDialog restores the overlay, then the pane", () => {
    const store = createStationStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    store.actions.pushDialog("dialog-confirm");
    expect(store.getState().input.focus).toEqual({ kind: "dialog", dialogId: "dialog-confirm" });
    store.actions.popDialog();
    expect(store.getState().input.focus).toEqual({ kind: "overlay", overlayId: WOSM_OVERLAY_ID });
    store.actions.closeOverlay();
    store.actions.pushDialog("dialog-confirm");
    store.actions.popDialog();
    expect(store.getState().input.focus).toEqual({ kind: "pane", paneId: MAIN_PANE_ID });
  });

  it("nested dialogs pop back to the dialog underneath", () => {
    const store = createStationStore();
    store.actions.pushDialog("dialog-outer");
    store.actions.pushDialog("dialog-inner");
    store.actions.popDialog();
    const state = store.getState();
    expect(state.input.dialogStack).toEqual(["dialog-outer"]);
    expect(state.input.focus).toEqual({ kind: "dialog", dialogId: "dialog-outer" });
  });

  it("popDialog on an empty stack is a silent no-op", () => {
    const { store, count } = createCountingStore();
    store.actions.popDialog();
    expect(count()).toEqual(0);
  });

  it("notifies exactly once per state change", () => {
    const { store, count } = createCountingStore();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    store.actions.closeOverlay();
    expect(count()).toEqual(2);
  });

  it("unsubscribe stops notifications", () => {
    const store = createStationStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    expect(notifications).toEqual(0);
  });
});

describe("createStationStore primary-agent bookkeeping", () => {
  const roleOf = (store: ReturnType<typeof createStationStore>, paneId: string) =>
    store.getState().workspace.panes.find((pane) => pane.id === paneId)?.role;

  it("seeds the boot pane as a shell with no primary agents", () => {
    const store = createStationStore();
    const { workspace } = store.getState();
    expect(roleOf(store, MAIN_PANE_ID)).toEqual("shell");
    expect(workspace.primaryAgentPaneByWorktree).toEqual({});
  });

  it("createPane records the given role and defaults to shell", () => {
    const store = createStationStore();
    store.actions.createPane("pane-agent", { role: "primary-agent" });
    store.actions.createPane("pane-plain");
    expect(roleOf(store, "pane-agent")).toEqual("primary-agent");
    expect(roleOf(store, "pane-plain")).toEqual("shell");
  });

  it("setPrimaryAgent records the role and the worktree mapping", () => {
    const store = createStationStore();
    store.actions.createPane("pane-agent");
    store.actions.setPrimaryAgent("wt_a", "pane-agent");
    expect(roleOf(store, "pane-agent")).toEqual("primary-agent");
    expect(store.getState().workspace.primaryAgentPaneByWorktree).toEqual({ wt_a: "pane-agent" });
  });

  it("setPrimaryAgent is a silent no-op for a non-member pane", () => {
    const { store, count } = createCountingStore();
    const before = store.getState();
    store.actions.setPrimaryAgent("wt_a", "pane-ghost");
    expect(store.getState()).toBe(before);
    expect(count()).toEqual(0);
  });

  it("setPrimaryAgent is a silent no-op when the pair is already recorded", () => {
    const { store, count } = createCountingStore();
    store.actions.createPane("pane-agent");
    store.actions.setPrimaryAgent("wt_a", "pane-agent");
    const baseline = count();
    const settled = store.getState();
    store.actions.setPrimaryAgent("wt_a", "pane-agent");
    expect(store.getState()).toBe(settled);
    expect(count()).toEqual(baseline);
  });

  it("setPrimaryAgent leaves focus and overlay untouched under an open overlay", () => {
    const store = createStationStore();
    store.actions.createPane("pane-agent");
    store.actions.openOverlay(WOSM_OVERLAY_ID);
    const focusBefore = store.getState().input.focus;
    const returnBefore = store.getState().input.overlayReturnFocus;

    store.actions.setPrimaryAgent("wt_a", "pane-agent");

    const { input, workspace } = store.getState();
    expect(input.activeOverlay).toEqual(WOSM_OVERLAY_ID);
    expect(input.focus).toEqual(focusBefore);
    expect(input.overlayReturnFocus).toEqual(returnBefore);
    expect(workspace.primaryAgentPaneByWorktree).toEqual({ wt_a: "pane-agent" });
  });

  it("closePane drops the pane record and any worktree mapping pointing at it", () => {
    const store = createStationStore();
    store.actions.createPane("pane-agent", { role: "primary-agent" });
    store.actions.setPrimaryAgent("wt_a", "pane-agent");
    store.actions.closePane("pane-agent");
    const { workspace } = store.getState();
    expect(roleOf(store, "pane-agent")).toBeUndefined();
    expect(workspace.primaryAgentPaneByWorktree).toEqual({});
  });
});
