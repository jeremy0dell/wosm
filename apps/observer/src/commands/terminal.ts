import type { TerminalFocusContext, TerminalFocusPayload, TerminalProvider } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ObserverCore } from "../reconcile/core.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import { publishRemovedSessionIfAbsent } from "./cleanup/events.js";
import {
  assertTerminalCloseAllowed,
  resolveTerminalTargetOrThrow,
  terminalTargetMissingError,
} from "./cleanup/index.js";
import { closeTerminalTarget } from "./cleanup/operations.js";
import type { CommandHandler, CommandHandlerContext } from "./queue.js";
import { reconcileAndPublish } from "./reconcile.js";

export type CreateTerminalFocusHandlerOptions = {
  core: ObserverCore;
  terminal: TerminalProvider;
};

export type CreateTerminalCloseHandlerOptions = {
  core: ObserverCore;
  terminal: TerminalProvider;
  persistence?: ObserverPersistence | undefined;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  commandTimeoutMs?: number | undefined;
};

export function createTerminalFocusHandler(
  options: CreateTerminalFocusHandlerOptions,
): CommandHandler {
  return async (context) => {
    assertTerminalFocusCommand(context);
    throwIfAborted(context.signal);
    const targetId = resolveTerminalFocusTargetId({
      core: options.core,
      command: context.command,
      providerId: options.terminal.id,
    });
    throwIfAborted(context.signal);
    await options.terminal.focusTarget(targetId, focusContextFromPayload(context.command.payload));
    throwIfAborted(context.signal);
  };
}

export function createTerminalCloseHandler(
  options: CreateTerminalCloseHandlerOptions,
): CommandHandler {
  return async (context) => {
    assertTerminalCloseCommand(context);
    throwIfAborted(context.signal);
    const snapshot = options.core.getSnapshot();
    const resolved = resolveTerminalTargetOrThrow({
      snapshot,
      payload: context.command.payload,
      providerId: options.terminal.id,
    });
    assertTerminalCloseAllowed(
      resolved.row,
      resolved.session,
      context.command.payload.force === true,
    );
    throwIfAborted(context.signal);
    await closeTerminalTarget({
      terminal: options.terminal,
      targetId: resolved.targetId,
      context,
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    throwIfAborted(context.signal);

    const nextSnapshot = await reconcileAndPublish({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
      reason: "command:terminal.close",
      trace: context.trace,
    });
    if (options.persistence !== undefined) {
      await publishRemovedSessionIfAbsent({
        previousSessionId: resolved.session?.id ?? resolved.row?.agent?.sessionId,
        nextSessionIds: new Set(nextSnapshot.sessions.map((session) => session.id)),
        persistence: options.persistence,
        eventBus: options.eventBus,
        context,
        clock: options.clock,
      });
    }
  };
}

function resolveTerminalFocusTargetId(input: {
  core: ObserverCore;
  command: Extract<CommandHandlerContext["command"], { type: "terminal.focus" }>;
  providerId: string;
}): string {
  const payload = input.command.payload;
  if (payload.targetId !== undefined) {
    return payload.targetId;
  }

  const snapshot = input.core.getSnapshot();
  if (payload.sessionId !== undefined) {
    const session = snapshot.sessions.find((candidate) => candidate.id === payload.sessionId);
    const targetId =
      session?.terminal.primaryAgentTargetId ?? session?.terminal.workspaceTargetId ?? undefined;
    if (targetId !== undefined) {
      return targetId;
    }
  }

  if (payload.worktreeId !== undefined) {
    const row = snapshot.rows.find((candidate) => candidate.id === payload.worktreeId);
    const targetId = row?.terminal?.primaryAgentTargetId ?? row?.terminal?.workspaceTargetId;
    if (targetId !== undefined) {
      return targetId;
    }
  }

  throw terminalTargetMissingError(input.providerId, {
    ...(payload.worktreeId === undefined ? {} : { worktreeId: payload.worktreeId }),
    ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
  });
}

function assertTerminalFocusCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "terminal.focus" }>;
} {
  if (context.command.type !== "terminal.focus") {
    throw new Error(`Expected terminal.focus command, received ${context.command.type}.`);
  }
}

function assertTerminalCloseCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "terminal.close" }>;
} {
  if (context.command.type !== "terminal.close") {
    throw new Error(`Expected terminal.close command, received ${context.command.type}.`);
  }
}

function focusContextFromPayload(payload: TerminalFocusPayload): TerminalFocusContext | undefined {
  if (payload.origin === undefined) {
    return undefined;
  }
  const context: TerminalFocusContext = {};
  context.origin = payload.origin;
  return context;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ?? {
        tag: "CancellationError",
        code: "COMMAND_CANCELLED",
        message: "Observer command was cancelled.",
      }
    );
  }
}
