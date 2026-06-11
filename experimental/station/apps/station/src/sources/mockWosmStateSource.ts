import { mockObserverSnapshot } from "./fixtures/mockObserverSnapshot.js";
import type { StationWosmState, StationWosmStateSource } from "./types.js";

/**
 * Static contract-shaped fixture behind the same boundary as the live source,
 * so layout and overlay work can move without an observer. The state object
 * is created once and never replaced: reference stability for
 * useSyncExternalStore falls out for free.
 */
export function createMockWosmStateSource(): StationWosmStateSource {
  const state: StationWosmState = {
    snapshot: mockObserverSnapshot,
    connection: {
      state: "connected",
      since: Date.parse(mockObserverSnapshot.generatedAt),
    },
  };

  return {
    name: "mock",
    start: () => {},
    stop: async () => {},
    getState: () => state,
    subscribe: () => () => {},
  };
}
