import type { WosmSnapshot } from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverCore } from "../reconcile/core.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import type { CommandHandler, CommandHandlerContext } from "./queue.js";

export type ReconcileAndPublishOptions = {
  core: ObserverCore;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
};

export async function reconcileAndPublish(
  options: ReconcileAndPublishOptions & {
    reason: string;
    trace?: {
      traceId?: string | undefined;
      spanId?: string | undefined;
    };
  },
): Promise<WosmSnapshot> {
  const snapshot = await options.core.reconcile(options.reason);
  options.eventBus?.publish({
    type: "observer.reconciled",
    at: snapshot.generatedAt,
    changed: 0,
    ...(options.trace?.traceId === undefined ? {} : { traceId: options.trace.traceId }),
    ...(options.trace?.spanId === undefined ? {} : { spanId: options.trace.spanId }),
  });
  return snapshot;
}

export function createObserverReconcileHandler(
  options: ReconcileAndPublishOptions,
): CommandHandler {
  return async (context) => {
    assertReconcileCommand(context);
    await reconcileAndPublish({
      ...options,
      reason: context.command.payload.reason ?? "command",
      trace: context.trace,
    });
  };
}

function assertReconcileCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "observer.reconcile" }>;
} {
  if (context.command.type !== "observer.reconcile") {
    throw new Error(`Expected observer.reconcile command, received ${context.command.type}.`);
  }
}
