// Pins the mouse router's modal guards to keyboard modality (the screen ×
// target matrix) and mouse/keyboard equivalence: a row click must produce
// exactly the state the row's slot key produces, in every mode where rows
// are interactive.
import { describe, expect, it } from "bun:test";
import type { StoreApi } from "zustand/vanilla";
import { manyProjectsSnapshot } from "../fixtures/scenarios.js";
import { selectDashboardViewport } from "../ported/selectors/dashboardViewport.js";
import { addTuiToast } from "../ported/state/toasts.js";
import { createTuiStore, type TuiStore } from "../ported/state/store.js";
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
});

function pendingStartIds(store: StoreApi<TuiStore>): string[] {
  return store.getState().localRows.pendingStart.map((row) => row.localId);
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
