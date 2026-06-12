import { describe, expect, it } from "bun:test";
import { createStationWosmClient } from "./createStationWosmClient.js";

const HOME_ONLY_ENV = { HOME: "/tmp/wosm-station-test-home" };

// The client carries no mode identity; tests distinguish modes through the
// same observable state and service behavior available to the app.
describe("createStationWosmClient", () => {
  it("defaults to the observer client, which starts empty and idle", () => {
    const client = createStationWosmClient(HOME_ONLY_ENV);

    expect(client.state.getState().snapshot).toBeUndefined();
    expect(client.state.getState().connection.state).toBe("idle");
  });

  it("uses the observer client for explicit observer mode", () => {
    const client = createStationWosmClient({
      ...HOME_ONLY_ENV,
      WOSM_STATION_SOURCE: "observer",
    });

    expect(client.state.getState().snapshot).toBeUndefined();
    expect(client.state.getState().connection.state).toBe("idle");
  });

  it("uses the mock client when requested", () => {
    const client = createStationWosmClient({ WOSM_STATION_SOURCE: "mock" });
    const state = client.state.getState();

    expect(state.connection.state).toBe("connected");
    expect(state.snapshot?.projects.length).toBeGreaterThan(0);
    expect(state.snapshot?.rows.length).toBeGreaterThan(0);
    expect(state.snapshot?.sessions.length).toBeGreaterThan(0);
  });

  it("mock state identifies itself through a snapshot alert, not code", () => {
    const client = createStationWosmClient({ WOSM_STATION_SOURCE: "mock" });
    const alerts = client.state.getState().snapshot?.alerts ?? [];

    expect(alerts.some((alert) => alert.message.includes("mock observer snapshot"))).toBe(true);
  });

  it("returns a reference-stable mock state for useSyncExternalStore", () => {
    const client = createStationWosmClient({ WOSM_STATION_SOURCE: "mock" });

    expect(client.state.getState()).toBe(client.state.getState());
  });

  it("mock command service preserves the Station dispatch gate", async () => {
    const client = createStationWosmClient({ WOSM_STATION_SOURCE: "mock" });
    const receipt = await client.service.dispatch({
      type: "observer.reconcile",
      payload: { reason: "test" },
    });

    expect(receipt.accepted).toBe(false);
    expect(receipt.error?.code).toBe("STATION_DISPATCH_PENDING");
  });

  it("rejects unsupported source names", () => {
    expect(() => createStationWosmClient({ WOSM_STATION_SOURCE: "fixture" })).toThrow(
      /Unsupported WOSM_STATION_SOURCE/,
    );
  });
});
