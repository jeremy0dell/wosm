import { scenarioState, type WosmScenarioName } from "../wosm/fixtures/scenarios.js";
import type { StationWosmState, StationWosmStateSource } from "./types.js";

/**
 * Static contract-shaped fixture behind the same boundary as the live source,
 * so layout and overlay work can move without an observer. The state object
 * is created once and never replaced: reference stability for
 * useSyncExternalStore falls out for free. Which scenario it serves is the
 * factory's decision (WOSM_STATION_SCENARIO), like everything mock-vs-live.
 */
export function createMockWosmStateSource(
  scenario: WosmScenarioName = "baseline",
): StationWosmStateSource {
  const state: StationWosmState = scenarioState(scenario);

  return {
    start: () => {},
    stop: async () => {},
    getState: () => state,
    subscribe: () => () => {},
  };
}
