import { randomUUID } from "node:crypto";
import type { ObservabilityRetentionConfig } from "@wosm/config";
import type {
  HarnessEventObservation,
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookReceipt,
  ProviderHookEvent,
  ProviderProjectConfig,
  WosmEvent,
} from "@wosm/contracts";
import {
  HarnessEventObservationSchema,
  HarnessEventReportReceiptSchema,
  HarnessEventReportSchema,
  HookReceiptSchema,
  ProviderHookEventSchema,
  WOSM_SCHEMA_VERSION,
} from "@wosm/contracts";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";
import type { ObserverPersistence } from "../persistence/index.js";
import {
  providerObservationExpiresAt,
  providerObservationRetentionDays,
} from "../persistence/retention.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ObserverEventBus } from "../runtime/eventBus.js";
import { ingestProviderHookEvent } from "./providerIngest.js";

export type HookIngestion = {
  ingest(event: ProviderHookEvent, options?: HookIngestOptions): Promise<HookReceipt>;
};

export type HarnessEventReportIngestion = {
  ingest(
    report: HarnessEventReport,
    options?: HookIngestOptions,
  ): Promise<HarnessEventReportReceipt>;
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
  requestReconcile?: (reason: string) => void;
  retention?: ObservabilityRetentionConfig;
};

export type CreateHarnessEventReportIngestionOptions = {
  persistence: ObserverPersistence;
  eventBus?: ObserverEventBus;
  clock?: RuntimeClock;
  requestReconcile?: (reason: string) => void;
  retention?: ObservabilityRetentionConfig;
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
              ...(options.retention === undefined ? {} : { retention: options.retention }),
            });

      const shouldReconcile = ingestOptions.triggerReconcile ?? true;
      if (shouldReconcile && options.requestReconcile !== undefined) {
        options.requestReconcile(`hook:${event.provider}:${event.event}`);
      }

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
      };
      if (providerIngestResult?.error !== undefined) {
        receipt.error = providerIngestResult.error;
      }
      return HookReceiptSchema.parse(receipt);
    },
  };
}

export function createHarnessEventReportIngestion(
  options: CreateHarnessEventReportIngestionOptions,
): HarnessEventReportIngestion {
  const clock = options.clock ?? systemClock;

  return {
    ingest: async (inputReport, ingestOptions = {}) => {
      const report = HarnessEventReportSchema.parse(inputReport);
      const receivedAt = toIsoTimestamp(clock.now());
      if (await hasReportedHarnessEvent(options.persistence, report.reportId)) {
        return HarnessEventReportReceiptSchema.parse({
          schemaVersion: WOSM_SCHEMA_VERSION,
          reportId: report.reportId,
          provider: report.provider,
          eventType: report.eventType,
          accepted: true,
          status: "accepted",
          receivedAt,
          projected: false,
          scheduledReconcile: false,
          deduped: true,
        });
      }

      const reportedEvent: WosmEvent = {
        type: "harness.eventReported",
        at: report.observedAt,
        reportId: report.reportId,
        provider: report.provider,
        eventType: report.eventType,
      };
      const retentionDays = providerObservationRetentionDays(options.retention);

      const persistResult = await runRuntimeBoundary(
        {
          operation: "observer.harnessEventReport.persist",
          clock,
          error: {
            tag: "HarnessEventReportIngestionError",
            code: "HARNESS_EVENT_REPORT_INGESTION_FAILED",
            message: "Observer could not persist the harness event report.",
            provider: report.provider,
          },
        },
        async () => {
          await options.persistence.recordEvent(reportedEvent, {
            source: "hook",
            createdAt: report.observedAt,
          });
          await options.persistence.recordProviderObservation({
            provider: report.provider,
            providerType: "harness",
            entityKind: "harness_event",
            entityKey: harnessEventReportEntityKey(report),
            payload: harnessEventObservationFromReport(report),
            observedAt: report.observedAt,
            expiresAt: providerObservationExpiresAt(report.observedAt, retentionDays),
          });
          options.eventBus?.publish(reportedEvent);
        },
      );

      if (!persistResult.ok) {
        return HarnessEventReportReceiptSchema.parse({
          schemaVersion: WOSM_SCHEMA_VERSION,
          reportId: report.reportId,
          provider: report.provider,
          eventType: report.eventType,
          accepted: false,
          status: "rejected",
          receivedAt,
          projected: false,
          scheduledReconcile: false,
          error: persistResult.error,
        });
      }

      const shouldReconcile = ingestOptions.triggerReconcile ?? true;
      if (shouldReconcile && options.requestReconcile !== undefined) {
        options.requestReconcile(`harness-report:${report.provider}:${report.eventType}`);
      }

      return HarnessEventReportReceiptSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        reportId: report.reportId,
        provider: report.provider,
        eventType: report.eventType,
        accepted: true,
        status: "accepted",
        receivedAt,
        projected: false,
        scheduledReconcile: shouldReconcile && options.requestReconcile !== undefined,
        deduped: false,
      });
    },
  };
}

async function hasIngestedHook(persistence: ObserverPersistence, hookId: string): Promise<boolean> {
  const events = await persistence.listEvents({ type: "hook.ingested" });
  return events.some(
    (event) => event.event.type === "hook.ingested" && event.event.hookId === hookId,
  );
}

async function hasReportedHarnessEvent(
  persistence: ObserverPersistence,
  reportId: string,
): Promise<boolean> {
  const events = await persistence.listEvents({ type: "harness.eventReported" });
  return events.some(
    (event) => event.event.type === "harness.eventReported" && event.event.reportId === reportId,
  );
}

function harnessEventObservationFromReport(report: HarnessEventReport): HarnessEventObservation {
  const observation: HarnessEventObservation = {
    provider: report.provider,
    observedAt: report.observedAt,
  };
  if (report.correlation?.sessionId !== undefined) {
    observation.sessionId = report.correlation.sessionId;
  }
  if (report.correlation?.worktreeId !== undefined) {
    observation.worktreeId = report.correlation.worktreeId;
  }
  if (report.correlation?.harnessRunId !== undefined) {
    observation.harnessRunId = report.correlation.harnessRunId;
  }
  if (report.status !== undefined) {
    observation.status = report.status;
  }
  if (report.diagnostics?.rawEventType !== undefined) {
    observation.rawEventType = report.diagnostics.rawEventType;
  }
  const providerData = providerDataFromReport(report);
  if (providerData !== undefined) {
    observation.providerData = providerData;
  }
  return HarnessEventObservationSchema.parse(observation);
}

function providerDataFromReport(report: HarnessEventReport): Record<string, unknown> | undefined {
  const providerData: Record<string, unknown> = {
    reportId: report.reportId,
    eventType: report.eventType,
  };
  if (report.correlation?.terminalTargetId !== undefined) {
    providerData.terminalTargetId = report.correlation.terminalTargetId;
  }
  if (report.correlation?.projectId !== undefined) {
    providerData.projectId = report.correlation.projectId;
  }
  if (report.correlation?.cwd !== undefined) {
    providerData.cwd = report.correlation.cwd;
  }
  if (report.correlation?.pid !== undefined) {
    providerData.pid = report.correlation.pid;
  }
  if (report.diagnostics !== undefined) {
    providerData.diagnostics = report.diagnostics;
  }
  if (report.providerData !== undefined) {
    providerData.providerData = report.providerData;
  }
  return Object.keys(providerData).length === 0 ? undefined : providerData;
}

function harnessEventReportEntityKey(report: HarnessEventReport): string {
  return (
    report.correlation?.harnessRunId ??
    report.correlation?.sessionId ??
    report.correlation?.worktreeId ??
    report.reportId
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
