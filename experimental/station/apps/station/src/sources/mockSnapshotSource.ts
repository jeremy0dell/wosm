import { mockObserverSnapshot } from "./fixtures/mockObserverSnapshot.js";
import type { StationSnapshotSource } from "./types.js";

export function createMockSnapshotSource(): StationSnapshotSource {
  return {
    async getSnapshot() {
      return mockObserverSnapshot;
    },
  };
}
