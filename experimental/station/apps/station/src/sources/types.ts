import type { ObserverService, WosmClientConnectionState } from "@wosm/client";
import type { WosmSnapshot } from "@wosm/contracts";

/**
 * What the overlay renders: the latest observer truth plus how trustworthy it
 * is. `snapshot` stays populated with the last good snapshot while the
 * connection is reconnecting/display-only/halted.
 */
export type StationWosmState = {
  snapshot?: WosmSnapshot;
  connection: WosmClientConnectionState;
};

/**
 * Source-swappable boundary between the overlay and where WOSM state comes
 * from. Deliberately carries no source identity: whether Station is showing
 * live or mock state is decided in exactly one place
 * (`createStationWosmClient`), and downstream code cannot tell the
 * difference — mock data identifies itself through ordinary contract
 * channels (a snapshot alert), not through code branches. `getState` is
 * reference-stable between changes (useSyncExternalStore-compatible).
 */
export interface StationWosmStateSource {
  getState(): StationWosmState;
  subscribe(listener: () => void): () => void;
}

/**
 * Identity-free Station boundary for WOSM dashboard state and commands.
 * Live mode uses one ObserverService for both runtime state and dispatch;
 * mock mode exposes the same shape with fixture state and the rejecting
 * command service.
 */
export type StationWosmClient = {
  state: StationWosmStateSource;
  service: ObserverService;
  start(): void;
  stop(): Promise<void>;
};
