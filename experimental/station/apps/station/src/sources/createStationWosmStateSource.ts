import { createMockWosmStateSource } from "./mockWosmStateSource.js";
import { createObserverWosmStateSource } from "./observerWosmStateSource.js";
import { resolveStationObserverSocketPath } from "./stationSocketPath.js";
import type { StationWosmStateSource, StationWosmStateSourceName } from "./types.js";

declare const Bun: {
  env: Record<string, string | undefined>;
};

export function createStationWosmStateSource(
  env: Record<string, string | undefined> = Bun.env,
): StationWosmStateSource {
  const source = readSourceName(env.WOSM_STATION_SOURCE);

  if (source === "mock") {
    return createMockWosmStateSource();
  }

  return createObserverWosmStateSource({
    socketPath: resolveStationObserverSocketPath(env),
  });
}

function readSourceName(value: string | undefined): StationWosmStateSourceName {
  if (value === undefined || value === "" || value === "observer") {
    return "observer";
  }

  if (value === "mock") {
    return "mock";
  }

  throw new Error(`Unsupported WOSM_STATION_SOURCE=${value}. Expected "observer" or "mock".`);
}
