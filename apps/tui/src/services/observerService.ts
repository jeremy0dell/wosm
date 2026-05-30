import type { CommandId, SafeError, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import type { ObserverApi, ObserverClient, TerminalCommandRecord } from "@wosm/protocol";
import { createObserverClient } from "@wosm/protocol";
import {
  isSafeError,
  type RuntimeBoundaryTask,
  type RuntimeSafeErrorFallback,
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
    loadSnapshot: () => loadSnapshot(client, timeoutMs),
    subscribeEvents: () => wrapSubscription(client.subscribe()),
    dispatch: (command: WosmCommand) => dispatchCommand(client, command, timeoutMs),
    waitForCommandCompletion: (commandId: CommandId) =>
      waitForCommandCompletion(client, commandId, timeoutMs),
    reconcile: (reason?: string) => requestReconcile(client, reason, timeoutMs),
  };
}

async function loadSnapshot(client: ObserverApi, timeoutMs: number): Promise<WosmSnapshot> {
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "tui.observer.snapshot.get",
      timeoutMs,
      error: tuiObserverError(
        "TUI_SNAPSHOT_FAILED",
        "The TUI could not load the observer snapshot.",
      ),
      timeoutError: tuiTimeoutError(
        "TUI_SNAPSHOT_TIMEOUT",
        "The TUI timed out while loading the observer snapshot.",
      ),
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
}

async function dispatchCommand(
  client: ObserverApi,
  command: WosmCommand,
  timeoutMs: number,
): ReturnType<TuiObserverService["dispatch"]> {
  return runTuiRequest(
    {
      operation: `tui.observer.command.${command.type}`,
      timeoutMs,
      error: tuiObserverError("TUI_COMMAND_FAILED", "The TUI could not dispatch the command."),
      timeoutError: tuiTimeoutError(
        "TUI_COMMAND_TIMEOUT",
        "The TUI timed out while dispatching the command.",
      ),
    },
    () => client.dispatch(command),
  );
}

async function waitForCommandCompletion(
  client: ObserverClient,
  commandId: CommandId,
  timeoutMs: number,
): Promise<TuiCommandCompletion> {
  return runTuiRequest(
    {
      operation: "tui.observer.command.wait",
      timeoutMs,
      error: tuiObserverError(
        "TUI_COMMAND_WAIT_FAILED",
        "The TUI could not observe command completion.",
      ),
      timeoutError: tuiTimeoutError(
        "TUI_COMMAND_WAIT_TIMEOUT",
        "The TUI timed out while waiting for command completion.",
      ),
    },
    () => waitForCommandTerminalRecord(client, commandId, timeoutMs),
  );
}

async function requestReconcile(
  client: ObserverApi,
  reason: string | undefined,
  timeoutMs: number,
): Promise<WosmSnapshot> {
  const receipt = await runTuiRequest(
    {
      operation: "tui.observer.reconcile",
      timeoutMs,
      error: tuiObserverError(
        "TUI_RECONCILE_FAILED",
        "The TUI could not request observer reconciliation.",
      ),
      timeoutError: tuiTimeoutError(
        "TUI_RECONCILE_TIMEOUT",
        "The TUI timed out while reconciling observer state.",
      ),
    },
    () => client.reconcile(reason),
  );
  return receipt.snapshot;
}

async function runTuiRequest<T>(
  input: {
    operation: string;
    timeoutMs: number;
    error: RuntimeSafeErrorFallback;
    timeoutError: RuntimeSafeErrorFallback;
  },
  task: RuntimeBoundaryTask<T>,
): Promise<T> {
  const result = await runRuntimeBoundaryWithTimeout(input, task);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function tuiObserverError(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "TuiObserverError",
    code,
    message,
  };
}

function tuiTimeoutError(code: string, message: string): RuntimeSafeErrorFallback {
  return {
    tag: "TimeoutError",
    code,
    message,
  };
}

async function waitForCommandTerminalRecord(
  client: ObserverClient,
  commandId: CommandId,
  timeoutMs: number,
): Promise<TuiCommandCompletion> {
  try {
    const record = await client.waitForCommand(commandId, { timeoutMs });
    return completionFromTerminalRecord(record);
  } catch (error) {
    throw mapCommandWaitError(error);
  }
}

function mapCommandWaitError(error: unknown): RuntimeSafeErrorFallback {
  if (isSafeError(error) && error.tag === "TimeoutError") {
    return tuiTimeoutError(
      "TUI_COMMAND_WAIT_TIMEOUT",
      "The TUI timed out while waiting for command completion.",
    );
  }
  return tuiObserverError(
    "TUI_COMMAND_WAIT_FAILED",
    "The TUI could not observe command completion.",
  );
}

function completionFromTerminalRecord(record: TerminalCommandRecord): TuiCommandCompletion {
  if (record.status === "succeeded") {
    return {
      status: "succeeded",
      commandId: record.id,
    };
  }
  return {
    status: "failed",
    commandId: record.id,
    error: record.error ?? missingCommandError(record.id),
  };
}

function missingCommandError(commandId: CommandId): SafeError {
  return {
    tag: "TuiObserverError",
    code: "TUI_COMMAND_FAILED_WITHOUT_ERROR",
    message: "The observer command failed without an error payload.",
    commandId,
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
