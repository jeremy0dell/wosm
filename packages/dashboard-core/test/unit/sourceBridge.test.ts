import type { WosmClientConnectionState } from "@wosm/client";
import type { SafeError, WosmSnapshot } from "@wosm/contracts";
import {
  applySnapshotSourceState,
  createInitialTuiState,
  type TuiState,
} from "@wosm/dashboard-core";
import { describe, expect, it } from "vitest";

const NOW = 1_750_000_000_000;

const lastError: SafeError = {
  tag: "ProtocolError",
  code: "PROTOCOL_CONNECT_FAILED",
  message: "Could not connect to the observer socket.",
};

describe("applySnapshotSourceState", () => {
  it("returns the same state when a no-snapshot failure update is content-identical", () => {
    const initial = createInitialTuiState();
    const connection: WosmClientConnectionState = {
      state: "reconnecting",
      since: NOW - 500,
      lastError,
    };

    const first = applySnapshotSourceState(initial, { connection }, NOW);
    expect(first.observerConnectionStatus.state).toBe("reconnecting");

    const second = applySnapshotSourceState(first, { connection }, NOW + 50);
    expect(second).toBe(first);
  });

  it("returns the same state when a display-only update is content-identical", () => {
    // Only identity matters on this path; the snapshot's fields are never read.
    const snapshot = {} as WosmSnapshot;
    const initial: TuiState = { ...createInitialTuiState(), snapshot };
    const connection: WosmClientConnectionState = {
      state: "displayOnly",
      since: NOW - 500,
      lastError,
    };

    const first = applySnapshotSourceState(initial, { snapshot, connection }, NOW);
    expect(first.observerConnectionStatus.state).toBe("displayOnly");
    expect(first.loading).toBe(false);

    const second = applySnapshotSourceState(first, { snapshot, connection }, NOW + 50);
    expect(second).toBe(first);
  });

  it("still produces a new state when the failure status actually changes", () => {
    const initial = createInitialTuiState();
    const first = applySnapshotSourceState(
      initial,
      { connection: { state: "reconnecting", since: NOW - 500, lastError } },
      NOW,
    );

    const second = applySnapshotSourceState(
      first,
      { connection: { state: "reconnecting", since: NOW - 100, lastError } },
      NOW + 50,
    );

    expect(second).not.toBe(first);
    expect(second.observerConnectionStatus).toMatchObject({ since: NOW - 100 });
  });
});
