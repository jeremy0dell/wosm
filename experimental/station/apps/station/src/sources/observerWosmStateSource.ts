import { createWosmClientRuntime, type ObserverService } from "@wosm/client";
import type { StationWosmStateSource } from "./types.js";

export type CreateObserverWosmStateSourceOptions = {
  socketPath?: string;
  /** Test seam: inject a fake observer service instead of a socket. */
  service?: ObserverService;
};

/**
 * Live source: a thin adapter over the shared @wosm/client runtime. The
 * runtime already owns snapshot loading, the event subscription loop,
 * reconnect backoff, and the connection state machine; Station only reads
 * `snapshot` and `connection` from its state.
 */
export function createObserverWosmStateSource(
  options: CreateObserverWosmStateSourceOptions,
): StationWosmStateSource {
  const runtime = createWosmClientRuntime(
    options.service !== undefined
      ? { service: options.service }
      : { socketPath: requireSocketPath(options.socketPath) },
  );

  return {
    start: () => {
      runtime.start();
    },
    stop: () => runtime.stop(),
    getState: () => runtime.getState(),
    subscribe: (listener) => runtime.subscribe(listener),
  };
}

function requireSocketPath(socketPath: string | undefined): string {
  if (socketPath === undefined || socketPath.length === 0) {
    throw new Error("createObserverWosmStateSource requires socketPath or service.");
  }
  return socketPath;
}
