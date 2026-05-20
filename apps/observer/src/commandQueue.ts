import { randomUUID } from "node:crypto";
import type { CommandId, CommandReceipt, WosmCommand } from "@wosm/contracts";
import { CommandReceiptSchema, WosmCommandSchema } from "@wosm/contracts";
import {
  Effect,
  type RuntimeClock,
  runtimeBoundaryEffect,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { createErrorEnvelope, toSafeError } from "./errors";
import type { ObserverIdFactory, ObserverPersistence } from "./persistence";

export type CommandHandlerContext = {
  commandId: CommandId;
  command: WosmCommand;
};

export type CommandHandler = (context: CommandHandlerContext) => Promise<void>;

export type CommandQueue = {
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  drain(): Promise<void>;
  registerHandler(commandType: WosmCommand["type"], handler: CommandHandler): void;
};

export type CreateCommandQueueOptions = {
  persistence: ObserverPersistence;
  clock?: RuntimeClock;
  idFactory?: Partial<Pick<ObserverIdFactory, "commandId" | "errorId">>;
  handlers?: Partial<Record<WosmCommand["type"], CommandHandler>>;
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
  const scopeChains = new Map<string, Promise<void>>();
  const pending = new Set<Promise<void>>();

  const queue: CommandQueue = {
    dispatch: async (inputCommand) => {
      const command = WosmCommandSchema.parse(inputCommand);
      const commandId = idFactory.commandId();
      await options.persistence.recordCommandAccepted({
        commandId,
        command,
        createdAt: now(clock),
      });
      await options.persistence.recordEvent(
        {
          type: "command.accepted",
          commandId,
          command,
        },
        { commandId, createdAt: now(clock) },
      );

      const scope = commandScope(command);
      const previous = scopeChains.get(scope) ?? Promise.resolve();
      const execution = previous.then(() =>
        executeCommand(options.persistence, handlers, clock, idFactory, {
          commandId,
          command,
        }),
      );
      const settled = execution.catch(() => undefined);
      scopeChains.set(scope, settled);
      pending.add(settled);
      settled.finally(() => {
        pending.delete(settled);
        if (scopeChains.get(scope) === settled) {
          scopeChains.delete(scope);
        }
      });

      return CommandReceiptSchema.parse({
        commandId,
        accepted: true,
        status: "accepted",
      });
    },

    drain: async () => {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
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
  context: CommandHandlerContext,
): Promise<void> {
  await persistence.markCommandStarted(context.commandId, now(clock));
  await persistence.recordEvent(
    {
      type: "command.started",
      commandId: context.commandId,
      command: context.command,
    },
    { commandId: context.commandId, createdAt: now(clock) },
  );

  const handler = handlers.get(context.command.type) ?? noopHandler;
  const result = await Effect.runPromise(
    Effect.catchAll(
      Effect.map(
        runtimeBoundaryEffect(
          {
            error: {
              tag: "CommandExecutionError",
              code: "COMMAND_EXECUTION_FAILED",
              message: "Observer command execution failed.",
            },
          },
          () => handler(context),
        ),
        () => ({ ok: true as const }),
      ),
      (error) => Effect.succeed({ ok: false as const, error }),
    ),
  );

  if (result.ok) {
    await persistence.markCommandSucceeded(context.commandId, now(clock));
    await persistence.recordEvent(
      {
        type: "command.succeeded",
        commandId: context.commandId,
      },
      { commandId: context.commandId, createdAt: now(clock) },
    );
    return;
  }

  const safeError = toSafeError(
    result.error,
    {
      tag: "CommandExecutionError",
      code: "COMMAND_EXECUTION_FAILED",
      message: "Observer command execution failed.",
    },
    { commandId: context.commandId },
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
    createdAt: now(clock),
  });
  await persistence.markCommandFailed({
    commandId: context.commandId,
    safeError,
    envelope,
    finishedAt: now(clock),
  });
  await persistence.recordEvent(
    {
      type: "command.failed",
      commandId: context.commandId,
      error: safeError,
    },
    { commandId: context.commandId, createdAt: now(clock) },
  );
}

async function noopHandler(): Promise<void> {}

function commandScope(command: WosmCommand): string {
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
