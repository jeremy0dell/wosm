import type { DatabaseSync } from "node:sqlite";
import { WosmEventSchema } from "@wosm/contracts";
import { Effect, systemClock, toIsoTimestamp } from "@wosm/runtime";
import { runSqliteTransactionEffect } from "../sqlite.js";
import * as commandStore from "./commands.js";
import * as correlationStore from "./correlations.js";
import { eventCommandId, eventTimestamp, listEvents, recordEvent } from "./events.js";
import { defaultIdFactory } from "./idFactory.js";
import {
  insertProviderObservation,
  listProviderObservations,
  pruneExpiredProviderObservations,
} from "./observations.js";
import * as recoveryBreadcrumbStore from "./recoveryBreadcrumbs.js";
import type { CreateObserverPersistenceOptions, ObserverPersistence } from "./types.js";

export type * from "./types.js";

export function createObserverPersistence(
  options: CreateObserverPersistenceOptions,
): ObserverPersistence {
  const clock = options.clock ?? systemClock;
  const idFactory = { ...defaultIdFactory, ...options.idFactory };
  const now = () => toIsoTimestamp(clock.now());
  const transaction = <T>(task: (database: DatabaseSync) => T): Promise<T> =>
    Effect.runPromise(runSqliteTransactionEffect(options.sqlite, task));

  return {
    recordCommandAccepted: (input) =>
      transaction((database) =>
        commandStore.recordCommandAccepted(database, {
          ...input,
          createdAt: input.createdAt ?? now(),
        }),
      ),

    markCommandStarted: (commandId, startedAt) =>
      transaction((database) =>
        commandStore.markCommandStarted(database, commandId, startedAt ?? now()),
      ),

    markCommandSucceeded: (commandId, finishedAt) =>
      transaction((database) =>
        commandStore.markCommandSucceeded(database, commandId, finishedAt ?? now()),
      ),

    markCommandFailed: (input) =>
      transaction((database) =>
        commandStore.markCommandFailed(database, {
          ...input,
          finishedAt: input.finishedAt ?? now(),
        }),
      ),

    getCommand: (commandId) =>
      transaction((database) => commandStore.getCommand(database, commandId)),

    listCommands: () => transaction(commandStore.listCommands),

    listCommandErrors: (commandId) =>
      transaction((database) => commandStore.listCommandErrors(database, commandId)),

    recordEvent: (event, eventOptions = {}) =>
      transaction((database) => {
        const parsedEvent = WosmEventSchema.parse(event);
        const eventId = idFactory.eventId();
        const createdAt = eventOptions.createdAt ?? eventTimestamp(parsedEvent) ?? now();
        const commandId = eventOptions.commandId ?? eventCommandId(parsedEvent);
        return recordEvent(database, parsedEvent, {
          eventId,
          source: eventOptions.source ?? "observer",
          createdAt,
          ...(commandId === undefined ? {} : { commandId }),
          ...(eventOptions.traceId === undefined ? {} : { traceId: eventOptions.traceId }),
          ...(eventOptions.spanId === undefined ? {} : { spanId: eventOptions.spanId }),
        });
      }),

    listEvents: (filter = {}) => transaction((database) => listEvents(database, filter)),

    recordProviderObservation: (input) =>
      transaction((database) =>
        insertProviderObservation(database, {
          ...input,
          id: idFactory.observationId(),
          observedAt: input.observedAt ?? now(),
        }),
      ),

    listProviderObservations: (listOptions = {}) =>
      transaction((database) =>
        listProviderObservations(database, {
          ...(listOptions.includeExpired === undefined
            ? {}
            : { includeExpired: listOptions.includeExpired }),
          referenceTime: listOptions.now ?? now(),
        }),
      ),

    pruneExpiredProviderObservations: (expiresBefore) =>
      transaction((database) => pruneExpiredProviderObservations(database, expiresBefore ?? now())),

    persistReconcileResult: (input) =>
      transaction((database) => {
        correlationStore.persistReconcileResult(database, input, {
          observedAt: input.observedAt ?? now(),
          idFactory,
        });
      }),

    listProjects: () => transaction(correlationStore.listProjects),

    listWorktrees: () => transaction(correlationStore.listWorktrees),

    listTerminalTargets: () => transaction(correlationStore.listTerminalTargets),

    listHarnessRuns: () => transaction(correlationStore.listHarnessRuns),

    listSessions: () => transaction(correlationStore.listSessions),

    recordRecoveryBreadcrumb: (input) =>
      transaction((database) => {
        const id = idFactory.breadcrumbId();
        const createdAt = input.createdAt ?? now();
        const lastSeenAt = input.lastSeenAt ?? createdAt;
        return recoveryBreadcrumbStore.recordRecoveryBreadcrumb(database, {
          ...input,
          id,
          createdAt,
          lastSeenAt,
        });
      }),

    listRecoveryBreadcrumbs: () => transaction(recoveryBreadcrumbStore.listRecoveryBreadcrumbs),
  };
}
