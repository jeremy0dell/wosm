import { describe, expect, it } from "bun:test";
import { createStationSnapshotSource } from "./createStationSnapshotSource.js";

describe("createStationSnapshotSource", () => {
  it("defaults to observer source and returns an empty object", async () => {
    const source = createStationSnapshotSource({});

    await expect(source.getSnapshot()).resolves.toEqual({});
  });

  it("uses observer source for explicit observer mode", async () => {
    const source = createStationSnapshotSource({ WOSM_STATION_SOURCE: "observer" });

    await expect(source.getSnapshot()).resolves.toEqual({});
  });

  it("uses mock source when requested", async () => {
    const source = createStationSnapshotSource({ WOSM_STATION_SOURCE: "mock" });
    const snapshot = await source.getSnapshot();

    expect(snapshot).toHaveProperty("projects");
    expect(snapshot).toHaveProperty("rows");
    expect(snapshot).toHaveProperty("sessions");
    expect(snapshot).not.toEqual({});
  });

  it("rejects unsupported source names", () => {
    expect(() =>
      createStationSnapshotSource({ WOSM_STATION_SOURCE: "fixture" }),
    ).toThrow(/Unsupported WOSM_STATION_SOURCE/);
  });
});
