import type {
  CommandId,
  CommandRecord,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";
import type { ObserverClient } from "@wosm/protocol";
import { createObserverClient } from "@wosm/protocol";
import {
  runRuntimeBoundaryWithRetryAndTimeout,
  runRuntimeBoundaryWithTimeout,
} from "@wosm/runtime";
import type { TuiCommandCompletion, TuiObserverService } from "./types.js";

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
    waitForCommandCompletion: async (commandId: CommandId): Promise<TuiCommandCompletion> => {
      const result = await runRuntimeBoundaryWithTimeout(
        {
          operation: "tui.observer.command.wait",
          timeoutMs,
          error: {
            tag: "TuiObserverError",
            code: "TUI_COMMAND_WAIT_FAILED",
            message: "The TUI could not observe command completion.",
          },
          timeoutError: {
            tag: "TimeoutError",
            code: "TUI_COMMAND_WAIT_TIMEOUT",
            message: "The TUI timed out while waiting for command completion.",
          },
        },
        ({ signal }) => waitForCommandCompletion(client, commandId, signal),
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

async function waitForCommandCompletion(
  client: ObserverClient,
  commandId: CommandId,
  signal: AbortSignal,
): Promise<TuiCommandCompletion> {
  const events = client.subscribe({
    type: ["command.succeeded", "command.failed"],
    commandId,
  });
  const iterator = events[Symbol.asyncIterator]();
  const cleanupOnAbort = () => {
    void iterator.return?.();
  };
  if (signal.aborted) {
    cleanupOnAbort();
  } else {
    signal.addEventListener("abort", cleanupOnAbort, { once: true });
  }

  try {
    let nextEvent = iterator.next();
    const existing = completionFromRecord(await client.getCommand(commandId));
    if (existing !== undefined) {
      return existing;
    }

    for (;;) {
      const next = await nextEvent;
      if (next.done) {
        const refreshed = completionFromRecord(await client.getCommand(commandId));
        if (refreshed !== undefined) {
          return refreshed;
        }
        throw {
          tag: "TuiObserverError",
          code: "TUI_COMMAND_EVENT_STREAM_CLOSED",
          message: "The observer event stream closed before command completion.",
        };
      }

      const completion = completionFromEvent(next.value, commandId);
      if (completion !== undefined) {
        return completion;
      }
      nextEvent = iterator.next();
    }
  } finally {
    signal.removeEventListener("abort", cleanupOnAbort);
    await iterator.return?.();
  }
}

function completionFromRecord(record: CommandRecord | undefined): TuiCommandCompletion | undefined {
  if (record?.status === "succeeded") {
    return {
      status: "succeeded",
      commandId: record.id,
    };
  }
  if (record?.status === "failed" && record.error !== undefined) {
    return {
      status: "failed",
      commandId: record.id,
      error: record.error,
    };
  }
  return undefined;
}

function completionFromEvent(
  event: WosmEvent,
  commandId: CommandId,
): TuiCommandCompletion | undefined {
  if (event.type !== "command.succeeded" && event.type !== "command.failed") {
    return undefined;
  }
  if (event.commandId !== commandId) {
    return undefined;
  }
  if (event.type === "command.succeeded") {
    return {
      status: "succeeded",
      commandId,
    };
  }
  if (event.type === "command.failed") {
    return {
      status: "failed",
      commandId,
      error: event.error,
    };
  }
  return undefined;
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
