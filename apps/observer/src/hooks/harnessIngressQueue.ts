import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HarnessIngressQueueHealth,
  SafeError,
} from "@wosm/contracts";
import {
  HarnessEventReportReceiptSchema,
  HarnessEventReportSchema,
  WOSM_SCHEMA_VERSION,
} from "@wosm/contracts";
import type { JsonlLogger } from "@wosm/observability";
import {
  type RuntimeClock,
  safeErrorFromUnknown,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";

export type HarnessIngressProcessResult = {
  receipt: HarnessEventReportReceipt;
  reconcileReason?: string | undefined;
};

export type HarnessIngressQueue = {
  enqueue(report: HarnessEventReport): HarnessEventReportReceipt;
  drain(): Promise<void>;
  shutdown(): Promise<void>;
  health(): HarnessIngressQueueHealth;
  recordSpoolDrain(input: { scanned: number; drained: number; failed: number }): void;
};

export type CreateHarnessIngressQueueOptions = {
  processReport(report: HarnessEventReport): Promise<HarnessIngressProcessResult>;
  requestReconcile?: (reason: string) => void;
  clock?: RuntimeClock;
  logger?: JsonlLogger;
  maxPendingReports?: number;
};

type QueuedHarnessReport = {
  report: HarnessEventReport;
  receivedAt: string;
};

type QueueMetrics = {
  enqueued: number;
  processed: number;
  coalesced: number;
  dropped: number;
  failed: number;
  lastProcessedAt?: string;
  lastError?: SafeError;
  lastDrain?: HarnessIngressQueueHealth["lastDrain"];
};

const maxRememberedReportIds = 10_000;
const defaultMaxPendingReports = 10_000;

export function createHarnessIngressQueue(
  options: CreateHarnessIngressQueueOptions,
): HarnessIngressQueue {
  const clock = options.clock ?? systemClock;
  const maxPendingReports = options.maxPendingReports ?? defaultMaxPendingReports;
  const pending = new Map<string, QueuedHarnessReport>();
  const readyKeys: string[] = [];
  const seenReportIds: string[] = [];
  const seenReportIdSet = new Set<string>();
  const metrics: QueueMetrics = {
    enqueued: 0,
    processed: 0,
    coalesced: 0,
    dropped: 0,
    failed: 0,
  };
  let scheduled = false;
  let processing: Promise<void> | undefined;
  let shuttingDown = false;

  const queue: HarnessIngressQueue = {
    enqueue: (inputReport) => {
      const report = HarnessEventReportSchema.parse(inputReport);
      const receivedAt = toIsoTimestamp(clock.now());
      if (shuttingDown) {
        return dropReport(report, receivedAt, {
          tag: "CancellationError",
          code: "HARNESS_INGRESS_QUEUE_SHUTTING_DOWN",
          message: "Observer harness ingress queue is shutting down.",
          provider: report.provider,
        });
      }
      if (seenReportIdSet.has(report.reportId)) {
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

      const key = coalesceKey(report);
      if (pending.has(key)) {
        metrics.coalesced += 1;
      } else {
        if (pending.size >= maxPendingReports) {
          return dropReport(report, receivedAt, {
            tag: "BackpressureError",
            code: "HARNESS_INGRESS_QUEUE_FULL",
            message: "Observer harness ingress queue is full.",
            provider: report.provider,
          });
        }
        readyKeys.push(key);
      }
      rememberReportId(report.reportId);
      pending.set(key, { report, receivedAt });
      metrics.enqueued += 1;
      scheduleProcessing();

      return HarnessEventReportReceiptSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        reportId: report.reportId,
        provider: report.provider,
        eventType: report.eventType,
        accepted: true,
        status: "accepted",
        receivedAt,
        projected: false,
        scheduledReconcile: true,
        deduped: false,
      });
    },

    drain: async () => {
      for (;;) {
        const active = processing;
        if (active === undefined && pending.size === 0 && readyKeys.length === 0) {
          return;
        }
        if (active !== undefined) {
          await active;
          continue;
        }
        if (!scheduled && readyKeys.length > 0) {
          scheduleProcessing();
        }
        await nextMacrotask();
      }
    },

    shutdown: async () => {
      shuttingDown = true;
      await queue.drain();
    },

    health: () => {
      const health: HarnessIngressQueueHealth = {
        depth: pending.size,
        enqueued: metrics.enqueued,
        processed: metrics.processed,
        coalesced: metrics.coalesced,
        dropped: metrics.dropped,
        failed: metrics.failed,
      };
      if (metrics.lastProcessedAt !== undefined) {
        health.lastProcessedAt = metrics.lastProcessedAt;
      }
      if (metrics.lastError !== undefined) {
        health.lastError = metrics.lastError;
      }
      if (metrics.lastDrain !== undefined) {
        health.lastDrain = metrics.lastDrain;
      }
      return health;
    },

    recordSpoolDrain: (input) => {
      metrics.lastDrain = {
        scanned: input.scanned,
        drained: input.drained,
        failed: input.failed,
        finishedAt: toIsoTimestamp(clock.now()),
      };
    },
  };

  function scheduleProcessing(): void {
    if (scheduled || processing !== undefined) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      processing = processReadyReports().finally(() => {
        processing = undefined;
        if (readyKeys.length > 0) {
          scheduleProcessing();
        }
      });
    }, 0);
  }

  async function processReadyReports(): Promise<void> {
    const reconcileReasons = new Set<string>();
    while (readyKeys.length > 0) {
      const key = readyKeys.shift();
      if (key === undefined) {
        continue;
      }
      const queued = pending.get(key);
      if (queued === undefined) {
        continue;
      }
      pending.delete(key);
      try {
        const result = await options.processReport(queued.report);
        metrics.processed += 1;
        metrics.lastProcessedAt = toIsoTimestamp(clock.now());
        if (result.receipt.status === "rejected") {
          metrics.failed += 1;
          if (result.receipt.error !== undefined) {
            metrics.lastError = result.receipt.error;
          }
        }
        if (result.reconcileReason !== undefined) {
          reconcileReasons.add(result.reconcileReason);
        }
      } catch (error) {
        metrics.failed += 1;
        metrics.lastProcessedAt = toIsoTimestamp(clock.now());
        metrics.lastError = safeErrorFromUnknown(error, {
          tag: "HarnessIngressQueueError",
          code: "HARNESS_INGRESS_PROCESS_FAILED",
          message: "Observer harness ingress queue could not process a queued report.",
          provider: queued.report.provider,
        });
        await options.logger?.error("Harness ingress queue processing failed.", {
          provider: queued.report.provider,
          reportId: queued.report.reportId,
          error: metrics.lastError,
        });
      }
    }

    if (reconcileReasons.size > 0) {
      options.requestReconcile?.(batchReconcileReason(reconcileReasons));
    }
  }

  function rememberReportId(reportId: string): void {
    seenReportIds.push(reportId);
    seenReportIdSet.add(reportId);
    while (seenReportIds.length > maxRememberedReportIds) {
      const oldReportId = seenReportIds.shift();
      if (oldReportId !== undefined) {
        seenReportIdSet.delete(oldReportId);
      }
    }
  }

  function dropReport(
    report: HarnessEventReport,
    receivedAt: string,
    error: SafeError,
  ): HarnessEventReportReceipt {
    metrics.dropped += 1;
    metrics.lastError = error;
    return rejectedReceipt(report, receivedAt, error);
  }

  return queue;
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function rejectedReceipt(
  report: HarnessEventReport,
  receivedAt: string,
  error: SafeError,
): HarnessEventReportReceipt {
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
    error,
  });
}

function coalesceKey(report: HarnessEventReport): string {
  const correlation = report.correlation;
  const stableAgentKey =
    correlation?.harnessRunId ??
    correlation?.sessionId ??
    correlation?.worktreeId ??
    correlation?.terminalTargetId ??
    correlation?.cwd ??
    report.reportId;
  const providerData = report.providerData;
  const turnKey =
    stringField(providerData, "turnId") ??
    stringField(providerData, "turn_id") ??
    stringField(providerData, "turnIndex") ??
    stringField(providerData, "turn_index") ??
    "-";
  const toolKey =
    stringField(providerData, "toolCallId") ??
    stringField(providerData, "tool_call_id") ??
    stringField(providerData, "toolUseId") ??
    stringField(providerData, "tool_use_id") ??
    stringField(providerData, "toolName") ??
    stringField(providerData, "tool_name") ??
    "-";
  return [report.provider, stableAgentKey, report.eventType, turnKey, toolKey].join(":");
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function batchReconcileReason(reasons: Set<string>): string {
  const sorted = [...reasons].sort();
  if (sorted.length === 1) {
    return sorted[0] ?? "harness-report-batch";
  }
  return `harness-report-batch:${sorted.length}`;
}
