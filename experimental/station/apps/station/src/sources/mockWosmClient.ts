import { scenarioState, type WosmScenarioName } from "../wosm/fixtures/scenarios.js";
import { createStationStubObserverService } from "../wosm/store/stubObserverService.js";
import type { StationWosmClient, StationWosmState, StationWosmStateSource } from "./types.js";

export function createMockWosmClient(scenario: WosmScenarioName = "baseline"): StationWosmClient {
  const state = createStaticStateSource(scenarioState(scenario));

  return {
    state,
    service: createStationStubObserverService(state),
    start: () => {},
    stop: async () => {},
  };
}

function createStaticStateSource(state: StationWosmState): StationWosmStateSource {
  return {
    getState: () => state,
    subscribe: () => () => {},
  };
}
