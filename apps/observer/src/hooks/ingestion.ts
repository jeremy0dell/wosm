import { randomUUID } from "node:crypto";
import type { HookReceipt, ProviderHookEvent, WosmEvent } from "@wosm/contracts";
import { HookReceiptSchema, ProviderHookEventSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";

export type HookIngestion = {
  ingest(event: ProviderHookEvent, options?: HookIngestOptions): Promise<HookReceipt>;
};

export type HookIngestOptions = {
  triggerReconcile?: boolean;
};

export type CreateHookIngestionOptions = {
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus;
  clock?: RuntimeClock;
  hookId?: () => string;
  reconcile?: (reason: string) => Promise<unknown>;
};

const defaultHookId = () => `hook_${randomUUID()}`;

export function createHookIngestion(options: CreateHookIngestionOptions): HookIngestion {
  const clock = options.clock ?? systemClock;
  const hookId = options.hookId ?? defaultHookId;

  return {
    ingest: async (inputEvent, ingestOptions = {}) => {
      const event = ProviderHookEventSchema.parse(inputEvent);
      const id = hookId();
      const hookEvent: WosmEvent = {
        type: "hook.ingested",
        at: event.receivedAt,
        hookId: id,
        provider: event.provider,
        event: event.event,
      };

      const persistResult = await runRuntimeBoundary(
        {
          operation: "observer.hook.persist",
          clock,
          error: {
            tag: "HookIngestionError",
            code: "HOOK_INGESTION_FAILED",
            message: "Observer could not persist the hook event.",
            provider: event.provider,
          },
        },
        async () => {
          await options.persistence.recordEvent(hookEvent, {
            source: "hook",
            createdAt: event.receivedAt,
          });
          options.eventBus?.publish(hookEvent);
        },
      );

      if (!persistResult.ok) {
        return HookReceiptSchema.parse({
          schemaVersion: WOSM_SCHEMA_VERSION,
          hookId: id,
          provider: event.provider,
          event: event.event,
          accepted: false,
          status: "rejected",
          receivedAt: event.receivedAt,
          error: persistResult.error,
        });
      }

      const shouldReconcile = ingestOptions.triggerReconcile ?? true;
      if (shouldReconcile && options.reconcile !== undefined) {
        const reconcileResult = await runRuntimeBoundary(
          {
            operation: "observer.hook.reconcile",
            clock,
            error: {
              tag: "HookIngestionError",
              code: "HOOK_RECONCILE_FAILED",
              message: "Observer ingested the hook event but reconciliation failed.",
              provider: event.provider,
            },
          },
          () => options.reconcile?.(`hook:${event.provider}:${event.event}`) ?? Promise.resolve(),
        );

        if (!reconcileResult.ok) {
          return HookReceiptSchema.parse({
            schemaVersion: WOSM_SCHEMA_VERSION,
            hookId: id,
            provider: event.provider,
            event: event.event,
            accepted: true,
            status: "ingested",
            receivedAt: event.receivedAt,
            reconciled: false,
            error: reconcileResult.error,
          });
        }
      }

      return HookReceiptSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: id,
        provider: event.provider,
        event: event.event,
        accepted: true,
        status: "ingested",
        receivedAt: event.receivedAt,
        reconciled: shouldReconcile && options.reconcile !== undefined,
      });
    },
  };
}

export function providerHookEvent(input: {
  provider: string;
  kind: ProviderHookEvent["kind"];
  event: string;
  clock?: RuntimeClock;
  projectId?: string;
  worktreeId?: string;
  sessionId?: string;
  payload?: unknown;
}): ProviderHookEvent {
  const clock = input.clock ?? systemClock;
  return ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    provider: input.provider,
    kind: input.kind,
    event: input.event,
    receivedAt: toIsoTimestamp(clock.now()),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
}
