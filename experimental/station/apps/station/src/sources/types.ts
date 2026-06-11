import type { WosmClientConnectionState } from "@wosm/client";
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
 * from. The live source adapts the @wosm/client runtime; the mock source
 * serves a static contract-shaped fixture. `getState` is reference-stable
 * between changes (useSyncExternalStore-compatible), and sources are
 * single-use like the runtime they wrap: a stopped source does not restart.
 */
export interface StationWosmStateSource {
  readonly name: StationWosmStateSourceName;
  start(): void;
  stop(): Promise<void>;
  getState(): StationWosmState;
  subscribe(listener: () => void): () => void;
}

export type StationWosmStateSourceName = "observer" | "mock";
