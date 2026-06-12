import {
  createObserverService,
  createWosmClientRuntime,
  type ObserverService,
} from "@wosm/client";
import { bridgeOperationService } from "@wosm/dashboard-core";
import type { StationWosmClient } from "./types.js";

export type CreateObserverWosmClientOptions = {
  socketPath?: string;
  /** Test seam: inject a fake observer service instead of a socket. */
  service?: ObserverService;
};

/**
 * Live client: one shared @wosm/client ObserverService feeds both runtime
 * state and command dispatch, preventing Station command paths from opening a
 * second observer connection. The exposed service facet routes reconcile and
 * snapshot loads through the runtime — a snapshot applied around the runtime
 * would be silently reverted by the next incremental event — so the reducer
 * base stays converged and the connected transition plus recovery toast
 * arrive via the state subscription. Dispatch and command-completion waits
 * pass through to the shared connection unchanged.
 */
export function createObserverWosmClient(
  options: CreateObserverWosmClientOptions,
): StationWosmClient {
  const service =
    options.service ??
    createObserverService({
      socketPath: requireSocketPath(options.socketPath),
      clientLabel: "Station",
    });
  const runtime = createWosmClientRuntime({ service, clientLabel: "Station" });

  return {
    state: {
      getState: () => runtime.getState(),
      subscribe: (listener) => runtime.subscribe(listener),
    },
    service: bridgeOperationService(service, runtime),
    start: () => {
      runtime.start();
    },
    stop: () => runtime.stop(),
  };
}

function requireSocketPath(socketPath: string | undefined): string {
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error("createObserverWosmClient requires socketPath or service.");
  }
  return socketPath;
}
