import type { TerminalFocusContext, TerminalFocusPayload, TerminalProvider } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ObserverCore } from "../reconcile/core.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import { assertCommandType } from "./assertCommand.js";
import { throwIfAborted } from "./cancellation.js";
import { publishRemovedSessionIfAbsent } from "./cleanup/events.js";
import {
  assertTerminalCloseAllowed,
  resolveTerminalTargetOrThrow,
  terminalTargetMissingError,
} from "./cleanup/index.js";
import { closeTerminalTarget } from "./cleanup/operations.js";
import type { CommandHandler } from "./queue.js";
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
    assertCommandType(context, "terminal.focus");
    throwIfAborted(context.signal);
    const targetId = resolveTerminalFocusTargetId({
      core: options.core,
      payload: context.command.payload,
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
    assertCommandType(context, "terminal.close");
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
  payload: TerminalFocusPayload;
  providerId: string;
}): string {
  try {
    return resolveTerminalTargetOrThrow({
      snapshot: input.core.getSnapshot(),
      payload: input.payload,
      providerId: input.providerId,
    }).targetId;
  } catch (error) {
    if (isWorktreeMissingError(error)) {
      const missing: { sessionId?: string; worktreeId?: string } = {};
      if (input.payload.sessionId !== undefined) missing.sessionId = input.payload.sessionId;
      if (input.payload.worktreeId !== undefined) missing.worktreeId = input.payload.worktreeId;
      throw terminalTargetMissingError(input.providerId, missing);
    }
    throw error;
  }
}

function isWorktreeMissingError(error: unknown): error is { code: "WORKTREE_NOT_FOUND" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "WORKTREE_NOT_FOUND"
  );
}

function focusContextFromPayload(payload: TerminalFocusPayload): TerminalFocusContext | undefined {
  if (payload.origin === undefined) {
    return undefined;
  }
  const context: TerminalFocusContext = {};
  context.origin = payload.origin;
  return context;
}
