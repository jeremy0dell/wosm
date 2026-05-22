import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../../persistence/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ObserverCore } from "../../reconcile/core.js";
import type { ObserverEventBus } from "../../runtime/eventBus.js";
import {
  assertWorktreeRemovalAllowed,
  closeTerminalForWorktree,
  publishRemovedSessionIfAbsent,
  publishWorktreeRemoved,
  removeWorktreeThroughProvider,
  resolveWorktreeRowOrThrow,
  stopHarnessForWorktree,
} from "../cleanup/index.js";
import type { CommandHandler, CommandHandlerContext } from "../queue.js";
import { reconcileAndPublish } from "../reconcile.js";
import { throwIfAborted } from "../session/shared.js";

export type CreateWorktreeRemoveHandlerOptions = {
  providers: ProviderRegistry;
  core: ObserverCore;
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  commandTimeoutMs?: number | undefined;
};

export function createWorktreeRemoveHandler(
  options: CreateWorktreeRemoveHandlerOptions,
): CommandHandler {
  return async (context) => {
    assertWorktreeRemoveCommand(context);
    throwIfAborted(context.signal);

    const payload = context.command.payload;
    const snapshot = options.core.getSnapshot();
    const row = resolveWorktreeRowOrThrow(snapshot, payload.worktreeId, payload.projectId);
    const previousSessionId = row.agent?.sessionId;
    const force = payload.force === true;
    assertWorktreeRemovalAllowed(row, force);

    await stopHarnessForWorktree({
      providers: options.providers,
      row,
      force,
      context,
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    throwIfAborted(context.signal);
    await closeTerminalForWorktree({
      terminal: options.providers.terminal,
      row,
      context,
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    throwIfAborted(context.signal);
    await removeWorktreeThroughProvider({
      providers: options.providers,
      row,
      force,
      context,
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    throwIfAborted(context.signal);

    const nextSnapshot = await reconcileAndPublish({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
      reason: "command:worktree.remove",
      trace: context.trace,
    });
    await publishRemovedSessionIfAbsent({
      previousSessionId,
      nextSessionIds: new Set(nextSnapshot.sessions.map((session) => session.id)),
      persistence: options.persistence,
      eventBus: options.eventBus,
      context,
      clock: options.clock,
    });
    await publishWorktreeRemoved({
      worktreeId: row.id,
      persistence: options.persistence,
      eventBus: options.eventBus,
      context,
      clock: options.clock,
    });
  };
}

function assertWorktreeRemoveCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "worktree.remove" }>;
} {
  if (context.command.type !== "worktree.remove") {
    throw new Error(`Expected worktree.remove command, received ${context.command.type}.`);
  }
}
