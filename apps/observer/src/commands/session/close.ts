import type { ProviderProjectConfig } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../../persistence/index.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { ObserverCore } from "../../reconcile/core.js";
import type { ObserverEventBus } from "../../runtime/eventBus.js";
import {
  assertSessionCloseAllowed,
  closeSessionResources,
  publishRemovedSessionIfAbsent,
  resolveRowForSession,
  resolveSessionOrThrow,
} from "../cleanup/index.js";
import type { CommandHandler, CommandHandlerContext } from "../queue.js";
import { reconcileAndPublish } from "../reconcile.js";
import { throwIfAborted } from "./shared.js";

export type CreateSessionCloseHandlerOptions = {
  projects: readonly ProviderProjectConfig[];
  providers: ProviderRegistry;
  core: ObserverCore;
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  commandTimeoutMs?: number | undefined;
};

export function createSessionCloseHandler(
  options: CreateSessionCloseHandlerOptions,
): CommandHandler {
  return async (context) => {
    assertSessionCloseCommand(context);
    throwIfAborted(context.signal);

    const payload = context.command.payload;
    const snapshot = options.core.getSnapshot();
    const session = resolveSessionOrThrow(snapshot, payload.sessionId);
    const row = resolveRowForSession(snapshot, session);
    assertSessionCloseAllowed(session, row, payload.force === true);
    await closeSessionResources({
      providers: options.providers,
      session,
      row,
      mode: payload.mode,
      force: payload.force === true,
      context,
      clock: options.clock,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    throwIfAborted(context.signal);

    const nextSnapshot = await reconcileAndPublish({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
      reason: "command:session.close",
      trace: context.trace,
    });
    await publishRemovedSessionIfAbsent({
      previousSessionId: session.id,
      nextSessionIds: new Set(nextSnapshot.sessions.map((candidate) => candidate.id)),
      persistence: options.persistence,
      eventBus: options.eventBus,
      context,
      clock: options.clock,
    });
  };
}

function assertSessionCloseCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "session.close" }>;
} {
  if (context.command.type !== "session.close") {
    throw new Error(`Expected session.close command, received ${context.command.type}.`);
  }
}
