// Layer conformance for the WOSM dashboard registration: real normalized
// byte sequences through the real keymap stack and input runtime, against
// the real coordination store. Pins the stack semantics the spike plan
// documents — reserved chords pierce the overlay layer, the overlay is
// modal (every sequence consumed), dismiss intents close via the
// coordination store, and terminal passthrough is untouched when the
// overlay is down.
import { describe, expect, it } from "bun:test";
import type { StoreApi } from "zustand/vanilla";
import { manyProjectsSnapshot } from "../wosm/fixtures/scenarios.js";
import { createTuiStore, type TuiStore } from "@wosm/dashboard-core";
import { FakeStationSource } from "../wosm/test/support/fakeStationSource.js";
import { FakeTuiObserverService } from "../wosm/test/support/fakeObserverService.js";
import { createStationStore, type StationStore } from "../state/store.js";
import { WOSM_OVERLAY_ID } from "../state/types.js";
import { routeKey } from "./router.js";
import { createStationKeymap, OVERLAY_TOGGLE_LEGACY, STATION_EXIT_LEGACY } from "./stationBindings.js";
import { createStationInputRuntime } from "./stationInput.js";

function makeWosmStore(): StoreApi<TuiStore> {
  const snapshot = manyProjectsSnapshot();
  const store = createTuiStore({
    source: new FakeStationSource(snapshot),
    service: new FakeTuiObserverService(snapshot),
    initialSnapshot: snapshot,
    persistentPopup: true,
    onDismiss: async () => {},
  });
  return store;
}

function makeStationStore(overlayOpen: boolean): StationStore {
  const station = createStationStore();
  if (overlayOpen) {
    station.actions.openOverlay(WOSM_OVERLAY_ID);
  }
  return station;
}

describe("wosm overlay layer in the keymap stack", () => {
  it("routes dashboard keys into the view machine and swallows them", () => {
    const wosm = makeWosmStore();
    const station = makeStationStore(true);
    const keymap = createStationKeymap(wosm);

    expect(routeKey("H", station.getState(), keymap)).toEqual({ kind: "swallowed" });
    expect(wosm.getState().screen).toEqual({ name: "help" });

    // Esc in help mode closes the MODE, not the overlay.
    expect(routeKey("\x1b", station.getState(), keymap)).toEqual({ kind: "swallowed" });
    expect(wosm.getState().screen).toEqual({ name: "dashboard" });
  });

  it("maps dashboard dismiss intents to overlay-close", () => {
    const wosm = makeWosmStore();
    const station = makeStationStore(true);
    const keymap = createStationKeymap(wosm);

    expect(routeKey("\x1b", station.getState(), keymap)).toEqual({
      kind: "overlay-close",
      overlayId: WOSM_OVERLAY_ID,
    });
    expect(routeKey("Q", station.getState(), keymap)).toEqual({
      kind: "overlay-close",
      overlayId: WOSM_OVERLAY_ID,
    });
  });

  it("lets reserved chords pierce the dashboard layer from any mode", () => {
    const wosm = makeWosmStore();
    const station = makeStationStore(true);
    const keymap = createStationKeymap(wosm);

    routeKey("/", station.getState(), keymap);
    expect(wosm.getState().screen).toMatchObject({ name: "search" });

    expect(routeKey(OVERLAY_TOGGLE_LEGACY, station.getState(), keymap)).toEqual({
      kind: "overlay-close",
      overlayId: WOSM_OVERLAY_ID,
    });
    expect(routeKey(STATION_EXIT_LEGACY, station.getState(), keymap)).toEqual({
      kind: "command",
      commandId: "station.exit",
    });
    // The search mode never saw the chords as text.
    expect(wosm.getState().screen).toMatchObject({ name: "search", value: "" });
  });

  it("swallows unknown escape sequences without polluting text inputs", () => {
    const wosm = makeWosmStore();
    const station = makeStationStore(true);
    const keymap = createStationKeymap(wosm);

    routeKey("/", station.getState(), keymap);
    routeKey("a", station.getState(), keymap);
    expect(routeKey("\x1b[15~", station.getState(), keymap)).toEqual({ kind: "swallowed" });
    expect(wosm.getState().screen).toMatchObject({ name: "search", value: "a" });
  });

  it("leaves terminal passthrough untouched while the overlay is down", () => {
    const wosm = makeWosmStore();
    const station = makeStationStore(false);
    const keymap = createStationKeymap(wosm);

    expect(routeKey("H", station.getState(), keymap)).toMatchObject({
      kind: "terminal-write",
      bytes: "H",
    });
    expect(wosm.getState().screen).toEqual({ name: "dashboard" });
  });
});

describe("wosm input through the station runtime", () => {
  function makeRuntime(overlayOpen: boolean) {
    const wosm = makeWosmStore();
    const station = makeStationStore(overlayOpen);
    const written: string[] = [];
    const pasted: string[] = [];
    const runtime = createStationInputRuntime({
      store: station,
      shutdown: () => {},
      wosmViewStore: wosm,
      writeToTerminal: (_paneId, bytes) => {
        written.push(bytes);
        return true;
      },
      pasteToTerminal: (_paneId, text) => {
        pasted.push(text);
        return true;
      },
    });
    return { wosm, station, runtime, written, pasted };
  }

  it("drives the full keyboard path: sequence -> machine -> coordination store", () => {
    const { wosm, station, runtime } = makeRuntime(true);

    expect(runtime.handleSequence("/")).toBe(true);
    expect(runtime.handleSequence("p")).toBe(true);
    expect(wosm.getState().screen).toMatchObject({ name: "search", value: "p" });

    expect(runtime.handleSequence("\x1b")).toBe(true); // cancel search
    expect(runtime.handleSequence("\x1b")).toBe(true); // dismiss overlay
    expect(station.getState().input.activeOverlay).toBeNull();
    expect(station.getState().input.focus.kind).toBe("pane");
  });

  it("delivers pastes to the dashboard's text inputs while the overlay is up", () => {
    const { wosm, runtime, pasted } = makeRuntime(true);
    runtime.handleSequence("/");

    let prevented = false;
    runtime.handlePaste({
      bytes: new TextEncoder().encode("station-overlay"),
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(pasted).toEqual([]);
    expect(wosm.getState().screen).toMatchObject({ name: "search", value: "station-overlay" });
  });

  it("strips control bytes from pastes so they cannot leak into text inputs", () => {
    const { wosm, runtime } = makeRuntime(true);
    runtime.handleSequence("/");

    runtime.handlePaste({
      bytes: new TextEncoder().encode("sta\x1b[31mtion\x00\nover\rlay\x07"),
      preventDefault: () => {},
    });

    expect(wosm.getState().screen).toMatchObject({
      name: "search",
      value: "sta[31mtion over lay",
    });
  });

  it("routes wosm mouse targets and closes the overlay on dismiss hints", () => {
    const { wosm, station, runtime } = makeRuntime(true);

    expect(
      runtime.dispatchMouse(
        { kind: "wosm", target: { kind: "projectHeader", projectId: "wosm" }, eventKind: "down" },
        undefined,
      ),
    ).toBe(true);
    expect([...wosm.getState().collapsedProjectIds]).toEqual(["wosm"]);

    expect(
      runtime.dispatchMouse(
        {
          kind: "wosm",
          target: { kind: "footerHint", bindingId: "wosm.dashboard.dismiss" },
          eventKind: "down",
        },
        undefined,
      ),
    ).toBe(true);
    expect(station.getState().input.activeOverlay).toBeNull();
  });

  it("ignores wosm mouse targets while the overlay is down", () => {
    const { wosm, runtime } = makeRuntime(false);

    runtime.dispatchMouse(
      { kind: "wosm", target: { kind: "projectHeader", projectId: "wosm" }, eventKind: "down" },
      undefined,
    );
    expect([...wosm.getState().collapsedProjectIds]).toEqual([]);
  });

  it("keeps the header click toggle working while the overlay is open", () => {
    const { station, runtime } = makeRuntime(true);

    expect(runtime.dispatchMouse({ kind: "header" }, undefined)).toBe(true);
    expect(station.getState().input.activeOverlay).toBeNull();
  });
});
