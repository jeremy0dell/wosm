import type { WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import type { ObserverClient } from "@wosm/protocol";
import { createObserverClient } from "@wosm/protocol";
import {
  runRuntimeBoundaryWithRetryAndTimeout,
  runRuntimeBoundaryWithTimeout,
} from "@wosm/runtime";
import type { TuiObserverService } from "./types.js";

export type CreateTuiObserverServiceOptions = {
  socketPath?: string;
  timeoutMs?: number;
  requestId?: () => string;
  client?: ObserverClient;
};

export function createTuiObserverService(
  options: CreateTuiObserverServiceOptions,
): TuiObserverService {
  const timeoutMs = options.timeoutMs ?? 5000;
  const client = options.client ?? createClient(options, timeoutMs);

  return {
    loadSnapshot: async () => {
      const result = await runRuntimeBoundaryWithRetryAndTimeout(
        {
          operation: "tui.observer.snapshot.get",
          timeoutMs,
          error: {
            tag: "TuiObserverError",
            code: "TUI_SNAPSHOT_FAILED",
            message: "The TUI could not load the observer snapshot.",
          },
          timeoutError: {
            tag: "TimeoutError",
            code: "TUI_SNAPSHOT_TIMEOUT",
            message: "The TUI timed out while loading the observer snapshot.",
          },
          retry: {
            retries: 0,
          },
        },
        () => client.getSnapshot(),
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    subscribeEvents: () => wrapSubscription(client.subscribe()),
    dispatch: async (command: WosmCommand) => {
      const result = await runRuntimeBoundaryWithTimeout(
        {
          operation: `tui.observer.command.${command.type}`,
          timeoutMs,
          error: {
            tag: "TuiObserverError",
            code: "TUI_COMMAND_FAILED",
            message: "The TUI could not dispatch the command.",
          },
          timeoutError: {
            tag: "TimeoutError",
            code: "TUI_COMMAND_TIMEOUT",
            message: "The TUI timed out while dispatching the command.",
          },
        },
        () => client.dispatch(command),
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    reconcile: async (reason?: string): Promise<WosmSnapshot> => {
      const result = await runRuntimeBoundaryWithTimeout(
        {
          operation: "tui.observer.reconcile",
          timeoutMs,
          error: {
            tag: "TuiObserverError",
            code: "TUI_RECONCILE_FAILED",
            message: "The TUI could not request observer reconciliation.",
          },
          timeoutError: {
            tag: "TimeoutError",
            code: "TUI_RECONCILE_TIMEOUT",
            message: "The TUI timed out while reconciling observer state.",
          },
        },
        () => client.reconcile(reason),
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.value.snapshot;
    },
  };
}

function createClient(options: CreateTuiObserverServiceOptions, timeoutMs: number): ObserverClient {
  if (options.socketPath === undefined) {
    throw new Error("createTuiObserverService requires socketPath or client.");
  }
  return createObserverClient({
    socketPath: options.socketPath,
    timeoutMs,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
  });
}

function wrapSubscription(events: AsyncIterable<WosmEvent>): AsyncIterable<WosmEvent> {
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = events[Symbol.asyncIterator]();
      return {
        next: () => iterator.next(),
        return: async () => {
          await iterator.return?.();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
