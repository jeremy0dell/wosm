import { randomUUID } from "node:crypto";
import { codexHookPayloadToHarnessEventReport, compactCodexHookPayload } from "@wosm/codex";
import type { ObserverPaths } from "@wosm/config";
import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookPayloadSummary,
  HookReceipt,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import { HookReceiptSchema, ProviderHookEventSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { componentLogPath, createJsonlLogger, type JsonlLogger } from "@wosm/observability";
import { compactPiHookPayload, piHookPayloadToHarnessEventReport } from "@wosm/pi";
import { createObserverClient } from "@wosm/protocol";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithTimeout,
  safeErrorFromUnknown,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { normalizeWorktrunkLifecycleEvent } from "@wosm/worktrunk";
import {
  deliverProviderHookWithSpooling,
  type ProviderDeliveryAttempt,
  type ProviderDeliveryPolicyDeps,
} from "./deliveryPolicy.js";
import { writeHarnessEventReportSpoolRecord, writeHookSpoolRecord } from "./spool.js";

export type ProviderHookSenderOptions = {
  paths: ObserverPaths;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  autoStart?: boolean | undefined;
  deliveryTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  rateLimitMs?: number | undefined;
};

type ProviderHookClientFactoryOptions = {
  timeoutMs: number;
};

export type ProviderHookSenderDeps = ProviderDeliveryPolicyDeps & {
  clientFactory?: (
    socketPath: string,
    options: ProviderHookClientFactoryOptions,
  ) => ReturnType<typeof createObserverClient>;
  clock?: RuntimeClock;
  writeSpool?: typeof writeHookSpoolRecord;
  writeReportSpool?: typeof writeHarnessEventReportSpoolRecord;
  hookId?: () => string;
  logger?: JsonlLogger;
};

export type SendProviderHookEventInput = ProviderHookSenderOptions & {
  provider: string;
  kind: ProviderHookEvent["kind"];
  event: string;
  payload?: unknown;
};

export type SendCodexHookInput = ProviderHookSenderOptions & {
  payload: unknown;
  env?: Record<string, string | undefined> | undefined;
};

export type SendPiHookInput = ProviderHookSenderOptions & {
  eventType: string;
  payload: unknown;
  env?: Record<string, string | undefined> | undefined;
};

const defaultHookId = () => `hook_${Date.now()}_${randomUUID()}`;
const defaultDeliveryTimeoutMs = 2000;

export async function sendWorktrunkHookEvent(
  input: ProviderHookSenderOptions & { event: string; payload?: unknown },
  deps: ProviderHookSenderDeps = {},
): Promise<HookReceipt> {
  return sendProviderHookEvent(
    {
      ...input,
      provider: "worktrunk",
      kind: "worktree",
      event: normalizeWorktrunkLifecycleEvent(input.event),
    },
    deps,
  );
}

export async function sendProviderHookEvent(
  input: SendProviderHookEventInput,
  deps: ProviderHookSenderDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const event = ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: deps.hookId?.() ?? defaultHookId(),
    provider: input.provider,
    kind: input.kind,
    event: input.event,
    receivedAt: toIsoTimestamp(clock.now()),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
  const payloadSummary = payloadSummaryFor(input.payload);

  return deliverProviderHookWithSpooling({
    paths: input.paths,
    event,
    payloadSummary,
    autoStart: input.autoStart ?? true,
    startupTimeoutMs: input.startupTimeoutMs ?? 1500,
    rateLimitMs: input.rateLimitMs ?? 2000,
    configPath: input.configPath,
    observerEntryPath: input.observerEntryPath,
    deps,
    deliver: () =>
      attemptHookDelivery(
        input.paths,
        event,
        input.deliveryTimeoutMs ?? defaultDeliveryTimeoutMs,
        deps,
      ),
    spoolReceipt: (error) => spool(input.paths, event, error, deps),
    recordReceipt: ({ paths, event, payloadSummary, receipt }) =>
      logAndReturn(paths, event, receipt, payloadSummary, deps),
  });
}

export async function sendCodexHookPayload(
  input: SendCodexHookInput,
  deps: ProviderHookSenderDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const enrichedPayload = enrichWosmEnv(input.payload, input.env ?? process.env);
  const eventName = stringField(enrichedPayload, "hook_event_name") ?? "unknown";
  if (!hasWosmOwnership(enrichedPayload)) {
    return ignoredHookReceipt({
      provider: "codex",
      event: eventName,
      clock,
      hookId: deps.hookId,
    });
  }

  const compaction = compactCodexHookPayload(enrichedPayload);
  try {
    const report = codexHookPayloadToHarnessEventReport({
      reportId: deps.hookId?.() ?? defaultHookId(),
      observedAt: toIsoTimestamp(clock.now()),
      payload: compaction.payload,
      diagnostics: diagnosticsFromCompaction(compaction),
    });
    return hookReceiptFromReportReceipt(
      await sendHarnessEventReport(input, report, compactionSummary(compaction), deps),
    );
  } catch (error) {
    return rejectedHookReceipt({
      provider: "codex",
      event: eventName,
      clock,
      error,
      hookId: deps.hookId,
    });
  }
}

export async function sendPiHookPayload(
  input: SendPiHookInput,
  deps: ProviderHookSenderDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const enrichedPayload = enrichWosmEnv(input.payload, input.env ?? process.env);
  if (!hasWosmOwnership(enrichedPayload)) {
    return ignoredHookReceipt({
      provider: "pi",
      event: input.eventType,
      clock,
      hookId: deps.hookId,
    });
  }

  const compaction = compactPiHookPayload(input.eventType, enrichedPayload);
  try {
    const report = piHookPayloadToHarnessEventReport({
      reportId: deps.hookId?.() ?? defaultHookId(),
      eventType: input.eventType,
      observedAt: toIsoTimestamp(clock.now()),
      payload: compaction.payload,
      diagnostics: diagnosticsFromCompaction(compaction),
    });
    return hookReceiptFromReportReceipt(
      await sendHarnessEventReport(input, report, compactionSummary(compaction), deps),
    );
  } catch (error) {
    return rejectedHookReceipt({
      provider: "pi",
      event: input.eventType,
      clock,
      error,
      hookId: deps.hookId,
    });
  }
}

export async function sendHarnessEventReport(
  options: ProviderHookSenderOptions,
  report: HarnessEventReport,
  payloadSummary: HookPayloadSummary,
  deps: ProviderHookSenderDeps = {},
): Promise<HarnessEventReportReceipt> {
  const syntheticEvent = ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: report.reportId,
    provider: report.provider,
    kind: "harness",
    event: report.eventType,
    receivedAt: report.observedAt,
    ...(report.providerData === undefined ? {} : { payload: report.providerData }),
  });
  const receipt = await deliverProviderHookWithSpooling({
    paths: options.paths,
    event: syntheticEvent,
    payloadSummary,
    autoStart: options.autoStart ?? true,
    startupTimeoutMs: options.startupTimeoutMs ?? 1500,
    rateLimitMs: options.rateLimitMs ?? 2000,
    configPath: options.configPath,
    observerEntryPath: options.observerEntryPath,
    deps,
    deliver: () =>
      attemptHarnessEventReportDelivery(
        options.paths,
        report,
        options.deliveryTimeoutMs ?? defaultDeliveryTimeoutMs,
        deps,
      ),
    spoolReceipt: async (error) =>
      hookReceiptFromReportReceipt(
        await spoolHarnessEventReport(options.paths, report, error, deps),
      ),
    recordReceipt: ({ paths, event, payloadSummary, receipt }) =>
      logAndReturn(paths, event, receipt, payloadSummary, deps),
  });
  return reportReceiptFromHookReceipt(report, receipt);
}

async function attemptHookDelivery(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  timeoutMs: number,
  deps: ProviderHookSenderDeps,
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
  deps: ProviderHookSenderDeps,
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
  deps: ProviderHookSenderDeps,
) {
  return runRuntimeBoundaryWithTimeout(
    {
      operation: "providerHooks.hook.deliver",
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
      const client = observerClient(paths.socketPath, timeoutMs, deps);
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
  deps: ProviderHookSenderDeps,
) {
  return runRuntimeBoundaryWithTimeout(
    {
      operation: "providerHooks.harnessEventReport.deliver",
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
      const client = observerClient(paths.socketPath, timeoutMs, deps);
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
  deps: ProviderHookSenderDeps,
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
  deps: ProviderHookSenderDeps,
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
  deps: ProviderHookSenderDeps,
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
          ? "Provider hook delivered to observer."
          : receipt.status === "spooled"
            ? "Provider hook spooled for later delivery."
            : "Provider hook rejected.",
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

function reportReceiptFromHookReceipt(
  report: HarnessEventReport,
  receipt: HookReceipt,
): HarnessEventReportReceipt {
  return {
    schemaVersion: WOSM_SCHEMA_VERSION,
    reportId: report.reportId,
    provider: report.provider,
    eventType: report.eventType,
    accepted: receipt.accepted,
    status:
      receipt.status === "ingested"
        ? "accepted"
        : receipt.status === "spooled"
          ? "spooled"
          : "rejected",
    receivedAt: receipt.receivedAt,
    projected: false,
    scheduledReconcile: false,
    ...(receipt.deduped === undefined ? {} : { deduped: receipt.deduped }),
    ...(receipt.error === undefined ? {} : { error: receipt.error }),
  };
}

function ignoredHookReceipt(input: {
  provider: string;
  event: string;
  clock: RuntimeClock;
  hookId?: (() => string) | undefined;
}): HookReceipt {
  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: input.hookId?.() ?? defaultHookId(),
    provider: input.provider,
    event: input.event,
    accepted: false,
    status: "ignored",
    receivedAt: toIsoTimestamp(input.clock.now()),
  });
}

function rejectedHookReceipt(input: {
  provider: string;
  event: string;
  clock: RuntimeClock;
  error: unknown;
  hookId?: (() => string) | undefined;
}): HookReceipt {
  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: input.hookId?.() ?? defaultHookId(),
    provider: input.provider,
    event: input.event,
    accepted: false,
    status: "rejected",
    receivedAt: toIsoTimestamp(input.clock.now()),
    error: safeErrorFromUnknown(input.error, {
      tag: "HookPayloadError",
      code: "HOOK_REPORT_INVALID",
      message: "Provider hook payload could not be normalized to a harness event report.",
      provider: input.provider,
    }),
  });
}

function payloadSummaryFor(payload: unknown): HookPayloadSummary {
  if (payload === undefined) {
    return {
      present: false,
      originalBytes: null,
      compactedBytes: null,
      compacted: false,
      omittedFieldNames: [],
    };
  }
  const bytes = jsonByteCount(payload);
  return {
    present: true,
    originalBytes: bytes,
    compactedBytes: bytes,
    compacted: false,
    omittedFieldNames: [],
  };
}

function compactionSummary(compaction: {
  originalByteCount: number | null;
  compactedByteCount: number | null;
  compacted: boolean;
  omittedFieldNames: string[];
}): HookPayloadSummary {
  return {
    present: true,
    originalBytes: compaction.originalByteCount,
    compactedBytes: compaction.compactedByteCount,
    compacted: compaction.compacted,
    omittedFieldNames: compaction.omittedFieldNames,
  };
}

function diagnosticsFromCompaction(compaction: {
  originalByteCount: number | null;
  compactedByteCount: number | null;
  compacted: boolean;
  omittedFieldNames: string[];
}) {
  return {
    payloadBytes: compaction.originalByteCount,
    compactedBytes: compaction.compactedByteCount,
    compacted: compaction.compacted,
    truncated: false,
    omittedFieldNames: compaction.omittedFieldNames,
  };
}

function enrichWosmEnv(payload: unknown, env: Record<string, string | undefined>): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    next[key] = value;
  }
  assignEnvField(next, "wosm_project_id", env.WOSM_PROJECT_ID);
  assignEnvField(next, "wosm_worktree_id", env.WOSM_WORKTREE_ID);
  assignEnvField(next, "wosm_worktree_path", env.WOSM_WORKTREE_PATH);
  assignEnvField(next, "wosm_session_id", env.WOSM_SESSION_ID);
  assignEnvField(next, "wosm_terminal_provider", env.WOSM_TERMINAL_PROVIDER);
  assignEnvField(next, "wosm_terminal_target_id", env.WOSM_TERMINAL_TARGET_ID);
  return next;
}

function hasWosmOwnership(payload: unknown): boolean {
  return (
    typeof stringField(payload, "wosm_session_id") === "string" &&
    typeof stringField(payload, "wosm_worktree_id") === "string"
  );
}

function assignEnvField(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (target[key] !== undefined || value === undefined || value.length === 0) {
    return;
  }
  target[key] = value;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function jsonByteCount(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return null;
    }
    return Buffer.byteLength(serialized, "utf8");
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observerClient(
  socketPath: string,
  timeoutMs: number,
  deps: ProviderHookSenderDeps,
): ReturnType<typeof createObserverClient> {
  return (
    deps.clientFactory?.(socketPath, { timeoutMs }) ??
    createObserverClient({ socketPath, timeoutMs })
  );
}
