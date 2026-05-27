import { randomUUID } from "node:crypto";
import type { WosmConfig } from "@wosm/config";
import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookPayloadSummary,
  HookReceipt,
  ProviderHookAdapter,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import { HookReceiptSchema, ProviderHookEventSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { componentLogPath, createJsonlLogger, type JsonlLogger } from "@wosm/observability";
import { createObserverClient } from "@wosm/protocol";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithTimeout,
  safeErrorFromUnknown,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import {
  deliverProviderHookWithSpooling,
  type ProviderDeliveryAttempt,
  type ProviderDeliveryPolicyDeps,
} from "./deliveryPolicy.js";
import { type ObserverPaths, resolveObserverPaths } from "./paths.js";
import {
  compactProviderHookEventPayload,
  decideProviderHookScope,
  harnessEventReportFromHookEvent,
  inferProviderHookKind,
  normalizeProviderHookEventName,
  shouldReportHarnessEvent,
} from "./providerAdapters.js";
import { writeHarnessEventReportSpoolRecord, writeHookSpoolRecord } from "./spool.js";

export type HookReceiverInput = {
  provider: string;
  event: string;
  hookId?: string | undefined;
  kind?: ProviderHookEvent["kind"];
  payload?: unknown;
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  providerAdapters?: readonly ProviderHookAdapter[] | undefined;
  paths?: ObserverPaths | undefined;
  autoStart?: boolean | undefined;
  deliveryTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  rateLimitMs?: number | undefined;
};

export type HookReceiverDeps = ProviderDeliveryPolicyDeps & {
  clientFactory?: (socketPath: string) => ReturnType<typeof createObserverClient>;
  clock?: RuntimeClock;
  writeSpool?: typeof writeHookSpoolRecord;
  writeReportSpool?: typeof writeHarnessEventReportSpoolRecord;
  hookId?: () => string;
  logger?: JsonlLogger;
};

const defaultHookId = () => `hook_${Date.now()}_${randomUUID()}`;

export async function receiveHookEvent(
  input: HookReceiverInput,
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const paths = input.paths ?? resolveObserverPaths(input.config);
  const hookId = input.hookId ?? deps.hookId?.() ?? defaultHookId();
  const providerAdapters = input.providerAdapters ?? [];
  const event = ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId,
    provider: input.provider,
    kind: input.kind ?? inferProviderHookKind(input.provider, providerAdapters),
    event: normalizeProviderHookEventName(input.provider, input.event, providerAdapters),
    receivedAt: toIsoTimestamp(clock.now()),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
  const scopeDecision = decideProviderHookScope(event, providerAdapters);
  if (scopeDecision.action === "ignore") {
    return ignoredHookReceipt(event);
  }
  const compacted = compactProviderHookEventPayload(event, providerAdapters);
  const deliveryTimeoutMs = input.deliveryTimeoutMs ?? 750;
  const startupTimeoutMs = input.startupTimeoutMs ?? 1500;
  const rateLimitMs = input.rateLimitMs ?? 2000;
  const autoStart = input.autoStart ?? input.config?.observer?.autoStartFromHooks !== false;

  if (shouldReportHarnessEvent(compacted.event, providerAdapters)) {
    const reportResult = harnessEventReportFromHookEvent(
      compacted.event,
      compacted.payloadSummary,
      defaultHookId,
      providerAdapters,
    );
    if (!reportResult.ok) {
      return logAndReturn(
        paths,
        compacted.event,
        rejectedHookReceiptForReportError(compacted.event, reportResult.error),
        compacted.payloadSummary,
        deps,
      );
    }
    return receiveHarnessEventReport(
      {
        paths,
        event: compacted.event,
        report: reportResult.report,
        payloadSummary: compacted.payloadSummary,
        deliveryTimeoutMs,
        startupTimeoutMs,
        rateLimitMs,
        autoStart,
        config: input.config,
        configPath: input.configPath,
        observerEntryPath: input.observerEntryPath,
      },
      deps,
    );
  }

  return deliverProviderHookWithSpooling({
    paths,
    event: compacted.event,
    payloadSummary: compacted.payloadSummary,
    autoStart,
    startupTimeoutMs,
    rateLimitMs,
    config: input.config,
    configPath: input.configPath,
    observerEntryPath: input.observerEntryPath,
    deps,
    deliver: () => attemptHookDelivery(paths, compacted.event, deliveryTimeoutMs, deps),
    spoolReceipt: (error) => spool(paths, compacted.event, error, deps),
    recordReceipt: ({ paths, event, payloadSummary, receipt }) =>
      logAndReturn(paths, event, receipt, payloadSummary, deps),
  });
}

async function receiveHarnessEventReport(
  input: {
    paths: ObserverPaths;
    event: ProviderHookEvent;
    report: HarnessEventReport;
    payloadSummary: HookPayloadSummary;
    deliveryTimeoutMs: number;
    startupTimeoutMs: number;
    rateLimitMs: number;
    autoStart: boolean;
    config?: WosmConfig | undefined;
    configPath?: string | undefined;
    observerEntryPath?: string | undefined;
  },
  deps: HookReceiverDeps,
): Promise<HookReceipt> {
  return deliverProviderHookWithSpooling({
    paths: input.paths,
    event: input.event,
    payloadSummary: input.payloadSummary,
    autoStart: input.autoStart,
    startupTimeoutMs: input.startupTimeoutMs,
    rateLimitMs: input.rateLimitMs,
    config: input.config,
    configPath: input.configPath,
    observerEntryPath: input.observerEntryPath,
    deps,
    deliver: () =>
      attemptHarnessEventReportDelivery(input.paths, input.report, input.deliveryTimeoutMs, deps),
    spoolReceipt: async (error) =>
      hookReceiptFromReportReceipt(
        await spoolHarnessEventReport(input.paths, input.report, error, deps),
      ),
    recordReceipt: ({ paths, event, payloadSummary, receipt }) =>
      logAndReturn(paths, event, receipt, payloadSummary, deps),
  });
}

async function attemptHookDelivery(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  timeoutMs: number,
  deps: HookReceiverDeps,
): Promise<ProviderDeliveryAttempt> {
  const delivery = await deliverHook(paths, event, timeoutMs, deps);
  if (delivery.ok && delivery.value.status === "ingested") {
    return { receipt: delivery.value };
  }
  if (delivery.ok) {
    const attempt: ProviderDeliveryAttempt = {};
    if (delivery.value.error !== undefined) {
      attempt.error = delivery.value.error;
    }
    return attempt;
  }
  return { error: delivery.error };
}

async function attemptHarnessEventReportDelivery(
  paths: ObserverPaths,
  report: HarnessEventReport,
  timeoutMs: number,
  deps: HookReceiverDeps,
): Promise<ProviderDeliveryAttempt> {
  const delivery = await deliverHarnessEventReport(paths, report, timeoutMs, deps);
  if (delivery.ok && delivery.value.status === "accepted") {
    return { receipt: hookReceiptFromReportReceipt(delivery.value) };
  }
  if (delivery.ok) {
    const attempt: ProviderDeliveryAttempt = {};
    if (delivery.value.error !== undefined) {
      attempt.error = delivery.value.error;
    }
    return attempt;
  }
  return { error: delivery.error };
}

async function deliverHook(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  timeoutMs: number,
  deps: HookReceiverDeps,
) {
  return runRuntimeBoundaryWithTimeout(
    {
      operation: "hookBridge.hook.deliver",
      clock: deps.clock,
      timeoutMs,
      error: {
        tag: "HookDeliveryError",
        code: "HOOK_DELIVERY_FAILED",
        message: "Hook event could not be delivered to the observer.",
        provider: event.provider,
      },
      timeoutError: {
        tag: "TimeoutError",
        code: "HOOK_DELIVERY_TIMEOUT",
        message: "Hook event delivery timed out.",
        provider: event.provider,
      },
    },
    async () => {
      const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
      const receipt = await client.ingestHookEvent(event);
      if (receipt.status !== "ingested") {
        throw (
          receipt.error ??
          safeErrorFromUnknown(receipt, {
            tag: "HookDeliveryError",
            code: "HOOK_REJECTED",
            message: "Observer rejected the hook event.",
            provider: event.provider,
          })
        );
      }
      return receipt;
    },
  );
}

async function deliverHarnessEventReport(
  paths: ObserverPaths,
  report: HarnessEventReport,
  timeoutMs: number,
  deps: HookReceiverDeps,
) {
  return runRuntimeBoundaryWithTimeout(
    {
      operation: "hookBridge.harnessEventReport.deliver",
      clock: deps.clock,
      timeoutMs,
      error: {
        tag: "HookDeliveryError",
        code: "HOOK_REPORT_DELIVERY_FAILED",
        message: "Harness event report could not be delivered to the observer.",
        provider: report.provider,
      },
      timeoutError: {
        tag: "TimeoutError",
        code: "HOOK_REPORT_DELIVERY_TIMEOUT",
        message: "Harness event report delivery timed out.",
        provider: report.provider,
      },
    },
    async () => {
      const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
      const receipt = await client.reportHarnessEvent(report);
      if (receipt.status !== "accepted") {
        throw (
          receipt.error ??
          safeErrorFromUnknown(receipt, {
            tag: "HookDeliveryError",
            code: "HOOK_REPORT_REJECTED",
            message: "Observer rejected the harness event report.",
            provider: report.provider,
          })
        );
      }
      return receipt;
    },
  );
}

async function spool(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  error: SafeError | undefined,
  deps: HookReceiverDeps,
): Promise<HookReceipt> {
  return (deps.writeSpool ?? writeHookSpoolRecord)({
    spoolDir: paths.hookSpoolDir,
    event,
    ...(error === undefined ? {} : { error }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
}

async function spoolHarnessEventReport(
  paths: ObserverPaths,
  report: HarnessEventReport,
  error: SafeError | undefined,
  deps: HookReceiverDeps,
): Promise<HarnessEventReportReceipt> {
  return (deps.writeReportSpool ?? writeHarnessEventReportSpoolRecord)({
    spoolDir: paths.hookSpoolDir,
    report,
    ...(error === undefined ? {} : { error }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
}

async function logAndReturn(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  receipt: HookReceipt,
  payloadSummary: HookPayloadSummary,
  deps: HookReceiverDeps,
): Promise<HookReceipt> {
  const logger =
    deps.logger ??
    createJsonlLogger({
      component: "hook",
      path: componentLogPath(paths.stateDir, "hook"),
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    });
  try {
    const level =
      receipt.status === "ingested" ? "info" : receipt.status === "spooled" ? "warn" : "error";
    await logger.log({
      level,
      message:
        receipt.status === "ingested"
          ? "Hook event delivered to observer."
          : receipt.status === "spooled"
            ? "Hook event spooled for later delivery."
            : "Hook event rejected.",
      provider: event.provider,
      attributes: {
        hookId: receipt.hookId,
        status: receipt.status,
        event: event.event,
        kind: event.kind,
        payloadSummary,
        ...(receipt.error === undefined ? {} : { error: receipt.error }),
      },
    });
  } catch {
    // Hook logging must never block provider hook completion.
  }
  return receipt;
}

function hookReceiptFromReportReceipt(receipt: HarnessEventReportReceipt): HookReceipt {
  const status = receipt.status === "accepted" ? "ingested" : receipt.status;
  const hookReceipt: HookReceipt = {
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: receipt.reportId,
    provider: receipt.provider,
    event: receipt.eventType,
    accepted: receipt.accepted,
    status,
    receivedAt: receipt.receivedAt,
  };
  if (status === "ingested") {
    hookReceipt.reconciled = false;
  }
  if (status === "spooled") {
    hookReceipt.spooled = true;
  }
  if (receipt.deduped !== undefined) {
    hookReceipt.deduped = receipt.deduped;
  }
  if (receipt.error !== undefined) {
    hookReceipt.error = receipt.error;
  }
  return HookReceiptSchema.parse(hookReceipt);
}

function ignoredHookReceipt(event: ProviderHookEvent): HookReceipt {
  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: event.hookId ?? defaultHookId(),
    provider: event.provider,
    event: event.event,
    accepted: false,
    status: "ignored",
    receivedAt: event.receivedAt,
  });
}

function rejectedHookReceiptForReportError(event: ProviderHookEvent, error: unknown): HookReceipt {
  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: event.hookId ?? defaultHookId(),
    provider: event.provider,
    event: event.event,
    accepted: false,
    status: "rejected",
    receivedAt: event.receivedAt,
    error: safeErrorFromUnknown(error, {
      tag: "HookPayloadError",
      code: "HOOK_REPORT_INVALID",
      message: "Hook payload could not be normalized to a harness event report.",
      provider: event.provider,
    }),
  });
}

function defaultClientFactory(socketPath: string) {
  return createObserverClient({ socketPath, timeoutMs: 500 });
}
