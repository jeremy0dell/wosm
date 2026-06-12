import { createMockWosmClient } from "./mockWosmClient.js";
import { createObserverWosmClient } from "./observerWosmClient.js";
import { resolveStationObserverSocketPath } from "./stationSocketPath.js";
import type { StationWosmClient } from "./types.js";
import {
  WOSM_SCENARIO_NAMES,
  type WosmScenarioName,
} from "../wosm/fixtures/scenarios.js";

declare const Bun: {
  env: Record<string, string | undefined>;
};

type StationWosmSourceName = "observer" | "mock";

// The only place that decides whether Station shows live or mock WOSM state.
// Downstream code receives one identity-free client boundary either way.
export function createStationWosmClient(
  env: Record<string, string | undefined> = Bun.env,
): StationWosmClient {
  const source = readSourceName(env.WOSM_STATION_SOURCE);

  if (source === "mock") {
    return createMockWosmClient(readScenarioName(env.WOSM_STATION_SCENARIO));
  }

  return createObserverWosmClient({
    socketPath: resolveStationObserverSocketPath(env),
  });
}

function readSourceName(value: string | undefined): StationWosmSourceName {
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
