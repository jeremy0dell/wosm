import { describe, expect, it } from "bun:test";
import { createStationWosmStateSource } from "./createStationWosmStateSource.js";

const HOME_ONLY_ENV = { HOME: "/tmp/wosm-station-test-home" };

describe("createStationWosmStateSource", () => {
  it("defaults to the observer source", () => {
    const source = createStationWosmStateSource(HOME_ONLY_ENV);

    expect(source.name).toBe("observer");
    expect(source.getState().snapshot).toBeUndefined();
    expect(source.getState().connection.state).toBe("idle");
  });

  it("uses the observer source for explicit observer mode", () => {
    const source = createStationWosmStateSource({
      ...HOME_ONLY_ENV,
      WOSM_STATION_SOURCE: "observer",
    });

    expect(source.name).toBe("observer");
  });

  it("uses the mock source when requested", () => {
    const source = createStationWosmStateSource({ WOSM_STATION_SOURCE: "mock" });
    const state = source.getState();

    expect(source.name).toBe("mock");
    expect(state.connection.state).toBe("connected");
    expect(state.snapshot?.projects.length).toBeGreaterThan(0);
    expect(state.snapshot?.rows.length).toBeGreaterThan(0);
    expect(state.snapshot?.sessions.length).toBeGreaterThan(0);
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
