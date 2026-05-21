import type { ProviderProjectConfig } from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import type { RuntimeClock } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ObserverCore } from "../reconcile/core.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import type { CommandQueue } from "./queue.js";
import { createObserverReconcileHandler } from "./reconcile.js";
import { createSessionCreateHandler } from "./session/create.js";
import type { SessionCommandIdFactory } from "./session/shared.js";
import { createSessionStartAgentHandler } from "./session/startAgent.js";
import { createTerminalFocusHandler } from "./terminal.js";

export type RegisterObserverCommandHandlersOptions = {
  queue: CommandQueue;
  core: ObserverCore;
  providers: ProviderRegistry;
  projects: readonly ProviderProjectConfig[];
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus | undefined;
  clock?: RuntimeClock | undefined;
  logger?: JsonlLogger | undefined;
  idFactory?: Partial<SessionCommandIdFactory> | undefined;
  commandTimeoutMs?: number | undefined;
};

export function registerObserverCommandHandlers(
  options: RegisterObserverCommandHandlersOptions,
): void {
  options.queue.registerHandler(
    "observer.reconcile",
    createObserverReconcileHandler({
      core: options.core,
      eventBus: options.eventBus,
      clock: options.clock,
    }),
  );
  options.queue.registerHandler(
    "terminal.focus",
    createTerminalFocusHandler({ core: options.core, terminal: options.providers.terminal }),
  );
  options.queue.registerHandler(
    "session.create",
    createSessionCreateHandler({
      projects: options.projects,
      providers: options.providers,
      core: options.core,
      persistence: options.persistence,
      eventBus: options.eventBus,
      clock: options.clock,
      idFactory: options.idFactory,
      commandTimeoutMs: options.commandTimeoutMs,
    }),
  );
  options.queue.registerHandler(
    "session.startAgent",
    createSessionStartAgentHandler({
      projects: options.projects,
      providers: options.providers,
      core: options.core,
      persistence: options.persistence,
      eventBus: options.eventBus,
      clock: options.clock,
      idFactory: options.idFactory,
      commandTimeoutMs: options.commandTimeoutMs,
    }),
  );

  void options.logger?.info("Observer command handlers registered.", {
    commandTypes: ["observer.reconcile", "terminal.focus", "session.create", "session.startAgent"],
  });
}
