import { randomUUID } from "node:crypto";
import type {
  CommandId,
  CommandReceipt,
  TraceContext,
  WosmCommand,
  WosmEvent,
} from "@wosm/contracts";
import { CommandReceiptSchema, WosmCommandSchema } from "@wosm/contracts";
import { createTraceContext, type JsonlLogger } from "@wosm/observability";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithTimeout,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { createErrorEnvelope, toSafeError } from "../diagnostics/errors.js";
import type { ObserverIdFactory, ObserverPersistence } from "../persistence/index.js";

export type CommandHandlerContext = {
  commandId: CommandId;
  trace: TraceContext;
  command: WosmCommand;
  signal: AbortSignal;
};

type CommandExecutionContext = Omit<CommandHandlerContext, "signal">;

export type CommandHandler = (context: CommandHandlerContext) => Promise<void>;

export type CommandQueue = {
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  drain(): Promise<void>;
  shutdown(): Promise<void>;
  registerHandler(commandType: WosmCommand["type"], handler: CommandHandler): void;
};

export type CreateCommandQueueOptions = {
  persistence: ObserverPersistence;
  clock?: RuntimeClock;
  idFactory?: Partial<Pick<ObserverIdFactory, "commandId" | "errorId">>;
  handlers?: Partial<Record<WosmCommand["type"], CommandHandler>>;
  logger?: JsonlLogger;
  eventBus?: {
    publish(event: WosmEvent): void;
  };
  commandTimeoutMs?: number;
};

const defaultCommandId = () => `cmd_${randomUUID()}`;
const defaultErrorId = () => `err_${randomUUID()}`;

export function createCommandQueue(options: CreateCommandQueueOptions): CommandQueue {
  const clock = options.clock ?? systemClock;
  const idFactory = {
    commandId: defaultCommandId,
    errorId: defaultErrorId,
    ...options.idFactory,
  };
  const handlers = new Map<WosmCommand["type"], CommandHandler>(
    Object.entries(options.handlers ?? {}) as [WosmCommand["type"], CommandHandler][],
  );
  // Commands serialize by the narrowest stable identity we can infer; unrelated scopes run in parallel.
  const scopeChains = new Map<string, Promise<void>>();
  const pending = new Set<Promise<void>>();
  const controllers = new Set<AbortController>();
  const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  let shuttingDown = false;

  const queue: CommandQueue = {
    dispatch: async (inputCommand) => {
      const command = WosmCommandSchema.parse(inputCommand);
      if (shuttingDown) {
        const receipt: CommandReceipt = {
          commandId: idFactory.commandId(),
          accepted: false,
          status: "rejected",
          error: {
            tag: "CancellationError",
            code: "COMMAND_QUEUE_SHUTTING_DOWN",
            message: "Observer command queue is shutting down.",
          },
        };
        return CommandReceiptSchema.parse(receipt);
      }
      const commandId = idFactory.commandId();
      const trace = createTraceContext({ operation: `command.${command.type}` });
      const controller = new AbortController();
      const acceptedEvent: WosmEvent = {
        type: "command.accepted",
        commandId,
        command,
        traceId: trace.traceId,
        spanId: trace.spanId,
      };
      await options.persistence.recordCommandAccepted({
        commandId,
        command,
        createdAt: now(clock),
        traceId: trace.traceId,
        spanId: trace.spanId,
      });
      await options.persistence.recordEvent(acceptedEvent, {
        commandId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        createdAt: now(clock),
      });
      await options.logger?.info("Command accepted.", {
        commandId,
        commandType: command.type,
        traceId: trace.traceId,
        spanId: trace.spanId,
      });
      options.eventBus?.publish(acceptedEvent);

      const scope = commandScope(command);
      const previous = scopeChains.get(scope) ?? Promise.resolve();
      const execution = previous.then(() =>
        executeCommand(
          options.persistence,
          handlers,
          clock,
          idFactory,
          {
            commandId,
            trace,
            command,
          },
          {
            ...(options.eventBus === undefined ? {} : { eventBus: options.eventBus }),
            ...(options.logger === undefined ? {} : { logger: options.logger }),
            signal: controller.signal,
            commandTimeoutMs,
          },
        ),
      );
      // Keep the per-scope chain non-throwing; failures are persisted and later commands still run.
      const settled = execution.catch(() => undefined);
      scopeChains.set(scope, settled);
      controllers.add(controller);
      pending.add(settled);
      settled.finally(() => {
        controllers.delete(controller);
        pending.delete(settled);
        if (scopeChains.get(scope) === settled) {
          scopeChains.delete(scope);
        }
      });

      const receipt: CommandReceipt = {
        commandId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        accepted: true,
        status: "accepted",
      };
      return CommandReceiptSchema.parse(receipt);
    },

    drain: async () => {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },

    shutdown: async () => {
      shuttingDown = true;
      for (const controller of controllers) {
        controller.abort(commandCancellationError());
      }
      await queue.drain();
    },

    registerHandler: (commandType, handler) => {
      handlers.set(commandType, handler);
    },
  };

  return queue;
}

async function executeCommand(
  persistence: ObserverPersistence,
  handlers: Map<WosmCommand["type"], CommandHandler>,
  clock: RuntimeClock,
  idFactory: Pick<ObserverIdFactory, "errorId">,
  context: CommandExecutionContext,
  runtime?: {
    eventBus?: {
      publish(event: WosmEvent): void;
    };
    logger?: JsonlLogger;
    signal?: AbortSignal;
    commandTimeoutMs?: number;
  },
): Promise<void> {
  await persistence.markCommandStarted(context.commandId, now(clock));
  const startedEvent: WosmEvent = {
    type: "command.started",
    commandId: context.commandId,
    command: context.command,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
  };
  await persistence.recordEvent(startedEvent, {
    commandId: context.commandId,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
    createdAt: now(clock),
  });
  await runtime?.logger?.info("Command started.", {
    commandId: context.commandId,
    commandType: context.command.type,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
  });
  runtime?.eventBus?.publish(startedEvent);

  const handler = handlers.get(context.command.type) ?? noopHandler;
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: `command.${context.command.type}`,
      clock,
      timeoutMs: runtime?.commandTimeoutMs ?? 30_000,
      error: {
        tag: "CommandExecutionError",
        code: "COMMAND_EXECUTION_FAILED",
        message: "Observer command execution failed.",
        traceId: context.trace.traceId,
      },
      timeoutError: {
        tag: "TimeoutError",
        code: "COMMAND_TIMEOUT",
        message: "Observer command execution timed out.",
        traceId: context.trace.traceId,
      },
      trace: context.trace,
    },
    async ({ signal }) => {
      // Combine runtime timeout and queue shutdown into the signal handlers receive.
      const linked = linkAbortSignals(signal, runtime?.signal);
      try {
        // Check before and after handler work because provider calls may notice abort cooperatively.
        throwIfCommandCancelled(linked.signal);
        await handler({ ...context, signal: linked.signal });
        throwIfCommandCancelled(linked.signal);
      } finally {
        linked.cleanup();
      }
    },
  );

  if (result.ok) {
    await persistence.markCommandSucceeded(context.commandId, now(clock));
    const succeededEvent: WosmEvent = {
      type: "command.succeeded",
      commandId: context.commandId,
      traceId: context.trace.traceId,
      spanId: context.trace.spanId,
    };
    await persistence.recordEvent(succeededEvent, {
      commandId: context.commandId,
      traceId: context.trace.traceId,
      spanId: context.trace.spanId,
      createdAt: now(clock),
    });
    await runtime?.logger?.info("Command succeeded.", {
      commandId: context.commandId,
      commandType: context.command.type,
      traceId: context.trace.traceId,
      spanId: context.trace.spanId,
    });
    runtime?.eventBus?.publish(succeededEvent);
    return;
  }

  const safeError = toSafeError(
    result.error,
    {
      tag: "CommandExecutionError",
      code: "COMMAND_EXECUTION_FAILED",
      message: "Observer command execution failed.",
    },
    { commandId: context.commandId, traceId: context.trace.traceId },
  );
  const envelope = createErrorEnvelope({
    id: idFactory.errorId(),
    error: result.error,
    fallback: {
      tag: "CommandExecutionError",
      code: "COMMAND_EXECUTION_FAILED",
      message: "Observer command execution failed.",
    },
    commandId: context.commandId,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
    createdAt: now(clock),
  });
  await persistence.markCommandFailed({
    commandId: context.commandId,
    safeError,
    envelope,
    finishedAt: now(clock),
  });
  const failedEvent: WosmEvent = {
    type: "command.failed",
    commandId: context.commandId,
    error: safeError,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
  };
  await persistence.recordEvent(failedEvent, {
    commandId: context.commandId,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
    createdAt: now(clock),
  });
  await runtime?.logger?.error("Command failed.", {
    commandId: context.commandId,
    commandType: context.command.type,
    traceId: context.trace.traceId,
    spanId: context.trace.spanId,
    error: safeError,
  });
  runtime?.eventBus?.publish(failedEvent);
}

async function noopHandler(context: CommandHandlerContext): Promise<void> {
  throwIfCommandCancelled(context.signal);
}

function commandCancellationError() {
  return {
    tag: "CancellationError",
    code: "COMMAND_CANCELLED",
    message: "Observer command was cancelled.",
  };
}

function throwIfCommandCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? commandCancellationError();
  }
}

function linkAbortSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? commandCancellationError());
    }
  };

  for (const signal of signals) {
    if (signal === undefined) {
      continue;
    }
    if (signal.aborted) {
      abort(signal);
      continue;
    }
    const listener = () => abort(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push(() => signal.removeEventListener("abort", listener));
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

// Prefer the narrowest scope so commands touching the same session, worktree, or project serialize.
function commandScope(command: WosmCommand): string {
  if ("targetId" in command.payload && typeof command.payload.targetId === "string") {
    return `terminal-target:${command.payload.targetId}`;
  }
  if ("sessionId" in command.payload && typeof command.payload.sessionId === "string") {
    return `session:${command.payload.sessionId}`;
  }
  if ("worktreeId" in command.payload && typeof command.payload.worktreeId === "string") {
    return `worktree:${command.payload.worktreeId}`;
  }
  if ("projectId" in command.payload && typeof command.payload.projectId === "string") {
    return `project:${command.payload.projectId}`;
  }
  return "global";
}

function now(clock: RuntimeClock): string {
  return toIsoTimestamp(clock.now());
}
