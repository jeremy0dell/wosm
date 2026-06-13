// Pins the mouse router's modal guards to keyboard modality (the screen ×
// target matrix) and mouse/keyboard equivalence: a row click must produce
// exactly the state the row's slot key produces, in every mode where rows
// are interactive.
import { describe, expect, it } from "bun:test";
import type { StoreApi } from "zustand/vanilla";
import { manyProjectsSnapshot } from "../fixtures/scenarios.js";
import { selectDashboardViewport } from "@wosm/dashboard-core";
import { addTuiToast } from "@wosm/dashboard-core";
import { createTuiStore, type TuiStore } from "@wosm/dashboard-core";
import { FakeStationSource } from "../test/support/fakeStationSource.js";
import { FakeTuiObserverService } from "../test/support/fakeObserverService.js";
import { routeWosmMouse } from "./wosmMouse.js";

function makeStore(): StoreApi<TuiStore> {
  const snapshot = manyProjectsSnapshot();
  return createTuiStore({
    source: new FakeStationSource(snapshot),
    service: new FakeTuiObserverService(snapshot),
    initialSnapshot: snapshot,
    persistentPopup: true,
    onDismiss: async () => {},
    initialState: { terminalRows: 12 },
  });
}

describe("routeWosmMouse", () => {
  it("makes a row click mean exactly what the row's slot key means", () => {
    const clicked = makeStore();
    const keyed = makeStore();
    // wt_wosm_none has no agent: activation adds a pending start row
    // synchronously, so the equivalence is observable without async effects.
    const rowId = "wt_wosm_none";
    const slot = slotForRow(keyed, rowId);

    routeWosmMouse({ kind: "row", rowId }, "down", clicked);
    keyed.getState().handleKey({ input: slot });

    expect(pendingStartIds(clicked)).toEqual(pendingStartIds(keyed));
    expect(pendingStartIds(clicked)).toEqual([`start:${rowId}`]);
  });

  it("chooses the clicked row in remove mode, same as the slot key", () => {
    const clicked = makeStore();
    const keyed = makeStore();
    const rowId = "wt_wosm_working";
    clicked.getState().handleKey({ input: "X" });
    keyed.getState().handleKey({ input: "X" });
    const slot = slotForRow(keyed, rowId);

    routeWosmMouse({ kind: "row", rowId }, "down", clicked);
    keyed.getState().handleKey({ input: slot });

    expect(clicked.getState().screen).toEqual(keyed.getState().screen);
    expect(clicked.getState().screen).toMatchObject({ name: "removeWorktree", step: "confirm" });
  });

  it("ignores row clicks in text-input modes", () => {
    const store = makeStore();
    store.getState().handleKey({ input: "/" });
    const before = store.getState();

    const outcome = routeWosmMouse({ kind: "row", rowId: "wt_wosm_idle" }, "down", store);

    expect(outcome).toEqual({ kind: "handled" });
    expect(store.getState().screen).toEqual(before.screen);
    expect(store.getState().searchQuery).toBe(before.searchQuery);
  });

  it("toggles project collapse on header click, dashboard mode only", () => {
    const store = makeStore();

    routeWosmMouse({ kind: "projectHeader", projectId: "wosm" }, "down", store);
    expect([...store.getState().collapsedProjectIds]).toEqual(["wosm"]);

    routeWosmMouse({ kind: "projectHeader", projectId: "wosm" }, "down", store);
    expect([...store.getState().collapsedProjectIds]).toEqual([]);

    store.getState().handleKey({ input: "H" });
    routeWosmMouse({ kind: "projectHeader", projectId: "wosm" }, "down", store);
    expect([...store.getState().collapsedProjectIds]).toEqual([]);
  });

  it("scrolls on wheel in row-interactive modes and nowhere else", () => {
    const store = makeStore();

    routeWosmMouse({ kind: "body" }, "scroll-down", store);
    expect(store.getState().scrollOffset).toBe(1);
    routeWosmMouse({ kind: "body" }, "scroll-up", store);
    expect(store.getState().scrollOffset).toBe(0);

    store.getState().handleKey({ input: "H" });
    routeWosmMouse({ kind: "body" }, "scroll-down", store);
    expect(store.getState().scrollOffset).toBe(0);
  });

  it("never scrolls the dashboard under a sheet backdrop", () => {
    const store = makeStore();
    const outcome = routeWosmMouse({ kind: "sheetBackdrop" }, "scroll-down", store);
    expect(outcome).toEqual({ kind: "handled" });
    expect(store.getState().scrollOffset).toBe(0);
  });

  it("pages on scroll-indicator clicks", () => {
    const store = makeStore();
    routeWosmMouse({ kind: "scrollIndicator", direction: "down" }, "down", store);
    expect(store.getState().scrollOffset).toBe(5);
    routeWosmMouse({ kind: "scrollIndicator", direction: "up" }, "down", store);
    expect(store.getState().scrollOffset).toBe(0);
  });

  it("dismisses toasts on click in any mode", () => {
    const store = makeStore();
    store.setState(addTuiToast(store.getState(), { kind: "info", message: "hello" }));
    store.getState().handleKey({ input: "H" });

    routeWosmMouse({ kind: "toast" }, "down", store);

    expect(store.getState().toasts).toEqual([]);
  });

  it("selects sheet choices by their slot key in picker modes only", () => {
    const store = makeStore();
    store.getState().handleKey({ input: "N" });
    store.getState().handleKey({ input: "P" });
    expect(store.getState().screen).toMatchObject({
      name: "newSession",
      flow: { mode: "pickProject" },
    });

    routeWosmMouse({ kind: "sheetChoice", choiceKey: "1" }, "down", store);
    expect(store.getState().screen).toMatchObject({
      name: "newSession",
      flow: { mode: "review" },
    });

    // Outside picker modes a stray choice click is inert (no text injection).
    store.getState().handleKey({ input: "", escape: true });
    store.getState().handleKey({ input: "/" });
    routeWosmMouse({ kind: "sheetChoice", choiceKey: "1" }, "down", store);
    expect(store.getState().screen).toMatchObject({ name: "search", value: "" });
  });

  it("dispatches footer hints as their binding's key, active mode only", () => {
    const store = makeStore();

    const helpClick = routeWosmMouse(
      { kind: "footerHint", bindingId: "wosm.dashboard.help" },
      "down",
      store,
    );
    expect(helpClick).toEqual({ kind: "handled" });
    expect(store.getState().screen).toEqual({ name: "help" });

    // The dashboard hint is stale while help is open: it must not fire.
    const stale = routeWosmMouse(
      { kind: "footerHint", bindingId: "wosm.dashboard.search" },
      "down",
      store,
    );
    expect(stale).toEqual({ kind: "handled" });
    expect(store.getState().screen).toEqual({ name: "help" });
  });

  it("reports close-overlay for dismiss hints so the router can close WOSM mode", () => {
    const store = makeStore();
    const outcome = routeWosmMouse(
      { kind: "footerHint", bindingId: "wosm.dashboard.dismiss" },
      "down",
      store,
    );
    expect(outcome).toEqual({ kind: "close-overlay" });
  });

  it("opens a shell pane for a row click at the worktree path", () => {
    const store = makeStore();
    // Derive cwd from the live snapshot, not a duplicated path literal, so the
    // assertion proves the resolver reads row.path (not some equivalent format).
    const outcome = routeWosmMouse({ kind: "openShellForRow", rowId: "wt_wosm_idle" }, "down", store);
    expect(outcome).toEqual({
      kind: "open-pane",
      paneId: "pane-wt-wt_wosm_idle",
      cwd: rowPath("wt_wosm_idle"),
    });
  });

  it("opens a shell pane for a project header click at the project root", () => {
    const store = makeStore();
    const outcome = routeWosmMouse({ kind: "openShellForProject", projectId: "wosm" }, "down", store);
    expect(outcome).toEqual({
      kind: "open-pane",
      paneId: "pane-proj-wosm",
      cwd: projectRoot("wosm"),
    });
  });

  it("keeps [+sh] live on a worktree that has a pending agent start", () => {
    const store = makeStore();
    const rowId = "wt_wosm_none";
    // Starting an agent drops the row out of rowChoices (it gains a pendingStart)
    // but it still renders a clickable [+sh]. Opening a shell is orthogonal to
    // agent activation, so the affordance must still resolve against snapshot.rows.
    routeWosmMouse({ kind: "row", rowId }, "down", store);
    const outcome = routeWosmMouse({ kind: "openShellForRow", rowId }, "down", store);
    expect(outcome).toEqual({ kind: "open-pane", paneId: `pane-wt-${rowId}`, cwd: rowPath(rowId) });
  });

  it("gates the open-shell affordance to dashboard mode", () => {
    const store = makeStore();
    store.getState().handleKey({ input: "/" }); // enter search (non-dashboard) mode

    expect(routeWosmMouse({ kind: "openShellForRow", rowId: "wt_wosm_idle" }, "down", store)).toEqual({
      kind: "handled",
    });
    expect(
      routeWosmMouse({ kind: "openShellForProject", projectId: "wosm" }, "down", store),
    ).toEqual({ kind: "handled" });
  });

  it("treats an unresolvable row or project as an inert click", () => {
    const store = makeStore();
    expect(routeWosmMouse({ kind: "openShellForRow", rowId: "wt_nope" }, "down", store)).toEqual({
      kind: "handled",
    });
    expect(
      routeWosmMouse({ kind: "openShellForProject", projectId: "ghost" }, "down", store),
    ).toEqual({ kind: "handled" });
  });
});

function pendingStartIds(store: StoreApi<TuiStore>): string[] {
  return store.getState().localRows.pendingStart.map((row) => row.localId);
}

// The fixture's worktree path / project root, read back from a fresh snapshot
// (deterministic builder) so tests assert equivalence to the data the resolver
// reads rather than duplicating the fixture's path format.
function rowPath(rowId: string): string {
  const path = manyProjectsSnapshot().rows.find((row) => row.id === rowId)?.path;
  if (path === undefined) {
    throw new Error(`no fixture row ${rowId}`);
  }
  return path;
}

function projectRoot(projectId: string): string {
  const root = manyProjectsSnapshot().projects.find((project) => project.id === projectId)?.root;
  if (root === undefined) {
    throw new Error(`no fixture project ${projectId}`);
  }
  return root;
}

function slotForRow(store: StoreApi<TuiStore>, rowId: string): string {
  const state = store.getState();
  if (state.snapshot === undefined) {
    throw new Error("store has no snapshot");
  }
  // Mirrors the viewport selector the actions module uses; resolved through
  // the store so the slot reflects current scroll/search state.
  const choice = selectDashboardViewport(state.snapshot, state).rowChoices.find(
    (candidate) => candidate.value.id === rowId,
  );
  if (choice === undefined) {
    throw new Error(`no slot for row ${rowId}`);
  }
  return choice.key;
}
