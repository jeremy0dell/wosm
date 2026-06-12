// Station command dispatch is client plan PR 4 (gated behind the input
// router, now landed). Until it ships, the WOSM view runs the REAL ported
// operations layer against this stub service: a dispatched command shows its
// genuine pending local-row visuals for the dispatch delay, then resolves as
// a rejected receipt whose SafeError names the gate — so the rows, throbbers,
// and toasts users see are the production code paths, not bespoke demo state.
// Un-stubbing is swapping this service for the real @wosm/client-backed one.
import type { CommandId, SafeError, WosmEvent } from "@wosm/contracts";
import type { StationWosmStateSource } from "../../sources/types.js";
import type { TuiObserverService } from "../ported/services/types.js";

export const STUB_DISPATCH_DELAY_MS = 900;

export type StationStubObserverServiceOptions = {
  /** Shortened in tests so pending-row visuals don't slow the suite. */
  dispatchDelayMs?: number;
};

export function createStationStubObserverService(
  source: StationWosmStateSource,
  options: StationStubObserverServiceOptions = {},
): TuiObserverService {
  const dispatchDelayMs = options.dispatchDelayMs ?? STUB_DISPATCH_DELAY_MS;
  let stubCommandCounter = 0;

  return {
    loadSnapshot: async () => {
      const snapshot = source.getState().snapshot;
      if (snapshot === undefined) {
        throw stubError("Snapshot load", "No observer snapshot is available yet.");
      }
      return snapshot;
    },
    subscribeEvents: () => neverEvents(),
    dispatch: async (command) => {
      await delay(dispatchDelayMs);
      stubCommandCounter += 1;
      return {
        commandId: stubCommandId(stubCommandCounter),
        accepted: false,
        status: "rejected",
        error: stubError(command.type),
      };
    },
    waitForCommandCompletion: async (commandId) => ({
      status: "failed",
      commandId,
      error: stubError("Command completion"),
    }),
    reconcile: async () => {
      throw stubError("observer.reconcile");
    },
  };
}

function stubError(what: string, message?: string): SafeError {
  return {
    tag: "CommandDispatchError",
    code: "STATION_DISPATCH_PENDING",
    message: message ?? `${what} lands with Station command dispatch (client plan PR 4).`,
  };
}

function stubCommandId(counter: number): CommandId {
  return `station-stub-${counter}` as CommandId;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function* neverEvents(): AsyncIterable<WosmEvent> {
  await new Promise<never>(() => {});
}
