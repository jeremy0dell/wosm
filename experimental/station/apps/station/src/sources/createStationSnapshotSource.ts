import { createMockSnapshotSource } from "./mockSnapshotSource.js";
import { createObserverSnapshotSource } from "./observerSnapshotSource.js";
import type { StationSnapshotSource, StationSnapshotSourceName } from "./types.js";

declare const Bun: {
  env: Record<string, string | undefined>;
};

export function createStationSnapshotSource(
  env: Record<string, string | undefined> = Bun.env,
): StationSnapshotSource {
  const source = readSourceName(env.WOSM_STATION_SOURCE);

  if (source === "mock") {
    return createMockSnapshotSource();
  }

  return createObserverSnapshotSource();
}

function readSourceName(value: string | undefined): StationSnapshotSourceName {
  if (value === undefined || value === "" || value === "observer") {
    return "observer";
  }

  if (value === "mock") {
    return "mock";
  }

  throw new Error(
    `Unsupported WOSM_STATION_SOURCE=${value}. Expected "observer" or "mock".`,
  );
}
