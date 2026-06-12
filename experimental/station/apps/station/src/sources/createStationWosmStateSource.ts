import {
  WOSM_SCENARIO_NAMES,
  type WosmScenarioName,
} from "../wosm/fixtures/scenarios.js";
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
    return createMockWosmStateSource(readScenarioName(env.WOSM_STATION_SCENARIO));
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

function readScenarioName(value: string | undefined): WosmScenarioName {
  if (value === undefined || value === "") {
    return "baseline";
  }
  if ((WOSM_SCENARIO_NAMES as readonly string[]).includes(value)) {
    return value as WosmScenarioName;
  }
  throw new Error(
    `Unsupported WOSM_STATION_SCENARIO=${value}. Expected one of: ${WOSM_SCENARIO_NAMES.join(", ")}.`,
  );
}
