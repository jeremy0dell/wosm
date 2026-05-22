import { randomUUID } from "node:crypto";
import type {
  HookReceipt,
  ProviderHookEvent,
  ProviderProjectConfig,
  WosmEvent,
} from "@wosm/contracts";
import { HookReceiptSchema, ProviderHookEventSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import { ingestProviderHookEvent } from "./providerIngest.js";

export type HookIngestion = {
  ingest(event: ProviderHookEvent, options?: HookIngestOptions): Promise<HookReceipt>;
};

export type HookIngestOptions = {
  triggerReconcile?: boolean;
};

export type CreateHookIngestionOptions = {
  persistence: ObserverPersistence;
  providers?: ProviderRegistry;
  projects?: ProviderProjectConfig[];
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
      const parsedEvent = ProviderHookEventSchema.parse(inputEvent);
      const id = parsedEvent.hookId ?? hookId();
      const event = ProviderHookEventSchema.parse({
        ...parsedEvent,
        hookId: id,
      });
      if (await hasIngestedHook(options.persistence, id)) {
        return HookReceiptSchema.parse({
          schemaVersion: WOSM_SCHEMA_VERSION,
          hookId: id,
          provider: event.provider,
          event: event.event,
          accepted: true,
          status: "ingested",
          receivedAt: event.receivedAt,
          reconciled: false,
          deduped: true,
        });
      }
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
        const receipt: HookReceipt = {
          schemaVersion: WOSM_SCHEMA_VERSION,
          hookId: id,
          provider: event.provider,
          event: event.event,
          accepted: false,
          status: "rejected",
          receivedAt: event.receivedAt,
          error: persistResult.error,
        };
        return HookReceiptSchema.parse(receipt);
      }

      const providerIngestResult =
        options.providers === undefined
          ? undefined
          : await ingestProviderHookEvent({
              event,
              providers: options.providers,
              projects: options.projects ?? [],
              persistence: options.persistence,
              clock,
            });

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
          const receipt: HookReceipt = {
            schemaVersion: WOSM_SCHEMA_VERSION,
            hookId: id,
            provider: event.provider,
            event: event.event,
            accepted: true,
            status: "ingested",
            receivedAt: event.receivedAt,
            reconciled: false,
            deduped: false,
            error: reconcileResult.error,
          };
          return HookReceiptSchema.parse(receipt);
        }
      }

      const receipt: HookReceipt = {
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: id,
        provider: event.provider,
        event: event.event,
        accepted: true,
        status: "ingested",
        receivedAt: event.receivedAt,
        reconciled: shouldReconcile && options.reconcile !== undefined,
        deduped: false,
      };
      if (providerIngestResult?.error !== undefined) {
        receipt.error = providerIngestResult.error;
      }
      return HookReceiptSchema.parse(receipt);
    },
  };
}

async function hasIngestedHook(persistence: ObserverPersistence, hookId: string): Promise<boolean> {
  const events = await persistence.listEvents({ type: "hook.ingested" });
  return events.some(
    (event) => event.event.type === "hook.ingested" && event.event.hookId === hookId,
  );
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
  const event: ProviderHookEvent = {
    schemaVersion: WOSM_SCHEMA_VERSION,
    provider: input.provider,
    kind: input.kind,
    event: input.event,
    receivedAt: toIsoTimestamp(clock.now()),
  };
  if (input.projectId !== undefined) event.projectId = input.projectId;
  if (input.worktreeId !== undefined) event.worktreeId = input.worktreeId;
  if (input.sessionId !== undefined) event.sessionId = input.sessionId;
  if (input.payload !== undefined) event.payload = input.payload;
  return ProviderHookEventSchema.parse(event);
}
