import { describe, expect, it } from "bun:test";
import { createStationWosmStateSource } from "./createStationWosmStateSource.js";

const HOME_ONLY_ENV = { HOME: "/tmp/wosm-station-test-home" };

// The source carries no identity; tests distinguish modes purely by observable
// behavior, the same way the rest of the app does.
describe("createStationWosmStateSource", () => {
  it("defaults to the observer source, which starts empty and idle", () => {
    const source = createStationWosmStateSource(HOME_ONLY_ENV);

    expect(source.getState().snapshot).toBeUndefined();
    expect(source.getState().connection.state).toBe("idle");
  });

  it("uses the observer source for explicit observer mode", () => {
    const source = createStationWosmStateSource({
      ...HOME_ONLY_ENV,
      WOSM_STATION_SOURCE: "observer",
    });

    expect(source.getState().snapshot).toBeUndefined();
    expect(source.getState().connection.state).toBe("idle");
  });

  it("uses the mock source when requested", () => {
    const source = createStationWosmStateSource({ WOSM_STATION_SOURCE: "mock" });
    const state = source.getState();

    expect(state.connection.state).toBe("connected");
    expect(state.snapshot?.projects.length).toBeGreaterThan(0);
    expect(state.snapshot?.rows.length).toBeGreaterThan(0);
    expect(state.snapshot?.sessions.length).toBeGreaterThan(0);
  });

  it("mock state identifies itself through a snapshot alert, not code", () => {
    const source = createStationWosmStateSource({ WOSM_STATION_SOURCE: "mock" });
    const alerts = source.getState().snapshot?.alerts ?? [];

    expect(alerts.some((alert) => alert.message.includes("mock observer snapshot"))).toBe(true);
  });

  it("returns a reference-stable mock state for useSyncExternalStore", () => {
    const source = createStationWosmStateSource({ WOSM_STATION_SOURCE: "mock" });

    expect(source.getState()).toBe(source.getState());
  });

  it("rejects unsupported source names", () => {
    expect(() => createStationWosmStateSource({ WOSM_STATION_SOURCE: "fixture" })).toThrow(
      /Unsupported WOSM_STATION_SOURCE/,
    );
  });
});
