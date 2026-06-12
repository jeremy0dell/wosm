import type { WosmClientConnectionState } from "@wosm/client";
import type { WosmSnapshot } from "@wosm/contracts";
import type { StationWosmState, StationWosmStateSource } from "../../../sources/types.js";

/**
 * Controllable StationWosmStateSource for store/bridge tests: the Station
 * counterpart of FakeTuiObserverService's emit/setSnapshot mutators, one
 * level up the boundary (source state instead of observer events).
 */
export class FakeStationSource implements StationWosmStateSource {
  started = 0;
  stopped = 0;
  private state: StationWosmState;
  private readonly listeners = new Set<() => void>();

  constructor(snapshot?: WosmSnapshot, connection?: WosmClientConnectionState) {
    this.state = {
      ...(snapshot === undefined ? {} : { snapshot }),
      connection: connection ?? { state: "connected", since: Date.now() },
    };
  }

  start(): void {
    this.started += 1;
  }

  async stop(): Promise<void> {
    this.stopped += 1;
  }

  getState(): StationWosmState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSnapshot(snapshot: WosmSnapshot): void {
    this.state = { ...this.state, snapshot };
    this.notify();
  }

  setConnection(connection: WosmClientConnectionState): void {
    this.state = { ...this.state, connection };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
