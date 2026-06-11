import type { StationSnapshotSource } from "./types.js";

export function createObserverSnapshotSource(): StationSnapshotSource {
  return {
    async getSnapshot() {
      return {};
    },
  };
}
