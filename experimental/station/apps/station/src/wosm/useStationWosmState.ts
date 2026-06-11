import { useSyncExternalStore } from "react";
import type { StationWosmState, StationWosmStateSource } from "../sources/types.js";

export function useStationWosmState(source: StationWosmStateSource): StationWosmState {
  return useSyncExternalStore(source.subscribe, source.getState, source.getState);
}
