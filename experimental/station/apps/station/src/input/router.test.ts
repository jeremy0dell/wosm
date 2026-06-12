import { describe, expect, it } from "bun:test";
import { createStationStore } from "../state/store.js";
import { MAIN_PANE_ID, WOSM_OVERLAY_ID, type StationState } from "../state/types.js";
import { routeKey, routeMouse, routePaste } from "./router.js";
import {
  createStationKeymap,
  createStationMouseBindings,
  OVERLAY_TOGGLE_LEGACY,
  STATION_EXIT_LEGACY,
} from "./stationBindings.js";

const keymap = createStationKeymap();
const mouseBindings = createStationMouseBindings();

function paneFocusedState(): StationState {
  return createStationStore().getState();
}

function overlayOpenState(): StationState {
  const store = createStationStore();
  store.actions.openOverlay(WOSM_OVERLAY_ID);
  return store.getState();
}

function dialogOpenState(): StationState {
  const store = createStationStore();
  store.actions.pushDialog("dialog-test");
  return store.getState();
}

describe("routeKey with the station keymap", () => {
  it("writes ordinary and control sequences to the focused pane", () => {
    for (const key of ["a", "\r", "\x03", "\x1b", "\x1b[A"]) {
      expect(routeKey(key, paneFocusedState(), keymap)).toEqual({
        kind: "terminal-write",
        paneId: MAIN_PANE_ID,
        bytes: key,
      });
    }
  });

  it("maps Ctrl-Q to the exit command while a pane is focused", () => {
    expect(routeKey(STATION_EXIT_LEGACY, paneFocusedState(), keymap)).toEqual({
      kind: "command",
      commandId: "station.exit",
    });
  });

  it("maps Ctrl-O to overlay-open while a pane is focused", () => {
    expect(routeKey(OVERLAY_TOGGLE_LEGACY, paneFocusedState(), keymap)).toEqual({
      kind: "overlay-open",
      overlayId: WOSM_OVERLAY_ID,
    });
  });

  it("swallows ordinary input while the overlay is open", () => {
    for (const key of ["a", "\r", "\x03"]) {
      expect(routeKey(key, overlayOpenState(), keymap)).toEqual({ kind: "swallowed" });
    }
  });

  it("lets Ctrl-Q pierce the overlay swallow", () => {
    expect(routeKey(STATION_EXIT_LEGACY, overlayOpenState(), keymap)).toEqual({
      kind: "command",
      commandId: "station.exit",
    });
  });

  it("maps Ctrl-O to overlay-close while the overlay is open", () => {
    expect(routeKey(OVERLAY_TOGGLE_LEGACY, overlayOpenState(), keymap)).toEqual({
      kind: "overlay-close",
      overlayId: WOSM_OVERLAY_ID,
    });
  });

  it("ignores unbound keys when no passthrough is active", () => {
    expect(routeKey("a", dialogOpenState(), keymap)).toEqual({ kind: "ignored" });
  });

  it("keeps reserved chords available under a dialog with no dialog layer", () => {
    expect(routeKey(STATION_EXIT_LEGACY, dialogOpenState(), keymap)).toEqual({
      kind: "command",
      commandId: "station.exit",
    });
  });
});

describe("routeMouse with the station bindings", () => {
  it("opens the overlay on header click when closed", () => {
    expect(routeMouse({ kind: "header" }, {}, paneFocusedState(), mouseBindings)).toEqual({
      kind: "overlay-open",
      overlayId: WOSM_OVERLAY_ID,
    });
  });

  it("closes the overlay on header click when open", () => {
    expect(routeMouse({ kind: "header" }, {}, overlayOpenState(), mouseBindings)).toEqual({
      kind: "overlay-close",
      overlayId: WOSM_OVERLAY_ID,
    });
  });

  it("focuses a pane on click when nothing modal is active", () => {
    expect(
      routeMouse({ kind: "pane", paneId: MAIN_PANE_ID }, {}, paneFocusedState(), mouseBindings),
    ).toEqual({ kind: "focus", target: { kind: "pane", paneId: MAIN_PANE_ID } });
  });

  it("does not focus a pane through the open overlay", () => {
    expect(
      routeMouse({ kind: "pane", paneId: MAIN_PANE_ID }, {}, overlayOpenState(), mouseBindings),
    ).toEqual({ kind: "swallowed" });
  });

  it("swallows header clicks while a dialog is open", () => {
    expect(routeMouse({ kind: "header" }, {}, dialogOpenState(), mouseBindings)).toEqual({
      kind: "swallowed",
    });
  });
});

describe("routePaste", () => {
  it("delivers paste to the focused pane", () => {
    expect(routePaste("hello", paneFocusedState())).toEqual({
      kind: "terminal-paste",
      paneId: MAIN_PANE_ID,
      text: "hello",
    });
  });

  it("ignores paste while the overlay is open", () => {
    expect(routePaste("hello", overlayOpenState())).toEqual({ kind: "ignored" });
  });

  it("ignores paste while a dialog is open", () => {
    expect(routePaste("hello", dialogOpenState())).toEqual({ kind: "ignored" });
  });
});
