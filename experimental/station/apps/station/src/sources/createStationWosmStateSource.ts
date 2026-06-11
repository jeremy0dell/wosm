import { createMockWosmStateSource } from "./mockWosmStateSource.js";
import { createObserverWosmStateSource } from "./observerWosmStateSource.js";
import { resolveStationObserverSocketPath } from "./stationSocketPath.js";
import type { StationWosmStateSource } from "./types.js";

declare const Bun: {
  env: Record<string, string | undefined>;
};

type StationWosmStateSourceName = "observer" | "mock";

// The only place that decides whether Station shows live or mock state.
// Everything downstream consumes the identity-free StationWosmStateSource.
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
