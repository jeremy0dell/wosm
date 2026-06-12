import {
  createObserverService,
  createWosmClientRuntime,
  type ObserverService,
} from "@wosm/client";
import type { StationWosmClient } from "./types.js";

export type CreateObserverWosmClientOptions = {
  socketPath?: string;
  /** Test seam: inject a fake observer service instead of a socket. */
  service?: ObserverService;
};

/**
 * Live client: one shared @wosm/client ObserverService feeds both runtime
 * state and command dispatch, preventing Station command paths from opening a
 * second observer connection.
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
    service,
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
