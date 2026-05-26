import { randomUUID } from "node:crypto";
import type { WosmConfig } from "@wosm/config";
import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookReceipt,
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
import { type HookObserverStartupDeps, startHookObserver } from "./observerStartup.js";
import { type ObserverPaths, resolveObserverPaths } from "./paths.js";
import {
  compactProviderHookEventPayload,
  decideProviderHookScope,
  type HookPayloadSummary,
  harnessEventReportFromHookEvent,
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
  paths?: ObserverPaths | undefined;
  autoStart?: boolean | undefined;
  deliveryTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  rateLimitMs?: number | undefined;
};

export type HookReceiverDeps = HookObserverStartupDeps & {
  clientFactory?: (socketPath: string) => ReturnType<typeof createObserverClient>;
  clock?: RuntimeClock;
  writeSpool?: typeof writeHookSpoolRecord;
  writeReportSpool?: typeof writeHarnessEventReportSpoolRecord;
  hookId?: () => string;
  logger?: JsonlLogger;
};

const lastStartByStateDir = new Map<string, number>();
const defaultHookId = () => `hook_${Date.now()}_${randomUUID()}`;

export async function receiveHookEvent(
  input: HookReceiverInput,
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const paths = input.paths ?? resolveObserverPaths(input.config);
  const hookId = input.hookId ?? deps.hookId?.() ?? defaultHookId();
  const event = ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId,
    provider: input.provider,
    kind: input.kind ?? inferHookKind(input.provider),
    event: normalizeProviderHookEventName(input.provider, input.event),
    receivedAt: toIsoTimestamp(clock.now()),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
  const scopeDecision = decideProviderHookScope(event);
  if (scopeDecision.action === "ignore") {
    return ignoredHookReceipt(event);
  }
  const compacted = compactProviderHookEventPayload(event);
  const deliveryTimeoutMs = input.deliveryTimeoutMs ?? 750;
  const startupTimeoutMs = input.startupTimeoutMs ?? 1500;
  const rateLimitMs = input.rateLimitMs ?? 2000;
  const autoStart = input.autoStart ?? input.config?.observer?.autoStartFromHooks !== false;

  if (shouldReportHarnessEvent(compacted.event)) {
    const reportResult = harnessEventReportFromHookEvent(
      compacted.event,
      compacted.payloadSummary,
      defaultHookId,
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

  const onlineDelivery = await deliverHook(paths, compacted.event, deliveryTimeoutMs, deps);
  if (onlineDelivery.ok && onlineDelivery.value.status === "ingested") {
    return logAndReturn(
      paths,
      compacted.event,
      onlineDelivery.value,
      compacted.payloadSummary,
      deps,
    );
  }

  const deliveryError = onlineDelivery.ok ? onlineDelivery.value.error : onlineDelivery.error;

  if (autoStart) {
    const startResult = await maybeStartObserver({
      paths,
      config: input.config,
      configPath: input.configPath,
      observerEntryPath: input.observerEntryPath,
      timeoutMs: startupTimeoutMs,
      rateLimitMs,
      deps,
    });
    if (startResult.ok) {
      const retryDelivery = await deliverHook(paths, compacted.event, deliveryTimeoutMs, deps);
      if (retryDelivery.ok && retryDelivery.value.status === "ingested") {
        return logAndReturn(
          paths,
          compacted.event,
          retryDelivery.value,
          compacted.payloadSummary,
          deps,
        );
      }
      const retryError = retryDelivery.ok ? retryDelivery.value.error : retryDelivery.error;
      const spooled = await spool(paths, compacted.event, retryError, deps);
      return logAndReturn(paths, compacted.event, spooled, compacted.payloadSummary, deps);
    }
    return logAndReturn(
      paths,
      compacted.event,
      await spool(paths, compacted.event, startResult.error, deps),
      compacted.payloadSummary,
      deps,
    );
  }

  return logAndReturn(
    paths,
    compacted.event,
    await spool(paths, compacted.event, deliveryError, deps),
    compacted.payloadSummary,
    deps,
  );
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
  const onlineDelivery = await deliverHarnessEventReport(
    input.paths,
    input.report,
    input.deliveryTimeoutMs,
    deps,
  );
  if (onlineDelivery.ok && onlineDelivery.value.status === "accepted") {
    return logAndReturn(
      input.paths,
      input.event,
      hookReceiptFromReportReceipt(onlineDelivery.value),
      input.payloadSummary,
      deps,
    );
  }

  const deliveryError = onlineDelivery.ok ? onlineDelivery.value.error : onlineDelivery.error;

  if (input.autoStart) {
    const startResult = await maybeStartObserver({
      paths: input.paths,
      config: input.config,
      configPath: input.configPath,
      observerEntryPath: input.observerEntryPath,
      timeoutMs: input.startupTimeoutMs,
      rateLimitMs: input.rateLimitMs,
      deps,
    });
    if (startResult.ok) {
      const retryDelivery = await deliverHarnessEventReport(
        input.paths,
        input.report,
        input.deliveryTimeoutMs,
        deps,
      );
      if (retryDelivery.ok && retryDelivery.value.status === "accepted") {
        return logAndReturn(
          input.paths,
          input.event,
          hookReceiptFromReportReceipt(retryDelivery.value),
          input.payloadSummary,
          deps,
        );
      }
      const retryError = retryDelivery.ok ? retryDelivery.value.error : retryDelivery.error;
      const spooled = await spoolHarnessEventReport(input.paths, input.report, retryError, deps);
      return logAndReturn(
        input.paths,
        input.event,
        hookReceiptFromReportReceipt(spooled),
        input.payloadSummary,
        deps,
      );
    }
    const spooled = await spoolHarnessEventReport(
      input.paths,
      input.report,
      startResult.error,
      deps,
    );
    return logAndReturn(
      input.paths,
      input.event,
      hookReceiptFromReportReceipt(spooled),
      input.payloadSummary,
      deps,
    );
  }

  const spooled = await spoolHarnessEventReport(input.paths, input.report, deliveryError, deps);
  return logAndReturn(
    input.paths,
    input.event,
    hookReceiptFromReportReceipt(spooled),
    input.payloadSummary,
    deps,
  );
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

async function maybeStartObserver(input: {
  paths: ObserverPaths;
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  timeoutMs: number;
  rateLimitMs: number;
  deps: HookReceiverDeps;
}) {
  const now = (input.deps.clock ?? systemClock).now().getTime();
  const lastStart = lastStartByStateDir.get(input.paths.stateDir) ?? 0;
  if (now - lastStart < input.rateLimitMs) {
    return {
      ok: false as const,
      error: safeErrorFromUnknown(undefined, {
        tag: "HookAutoStartRateLimitError",
        code: "HOOK_AUTOSTART_RATE_LIMITED",
        message: "Observer auto-start from hooks is rate-limited.",
      }),
    };
  }
  lastStartByStateDir.set(input.paths.stateDir, now);

  const started = await startHookObserver(
    {
      config: input.config,
      configPath: input.configPath,
      paths: input.paths,
      timeoutMs: input.timeoutMs,
      observerEntryPath: input.observerEntryPath,
    },
    input.deps,
  );
  if (started.status === "running") {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    error:
      started.error ??
      safeErrorFromUnknown(undefined, {
        tag: "ObserverStartupError",
        code: "OBSERVER_START_FAILED",
        message: "Observer could not be started for hook delivery.",
      }),
  };
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

function inferHookKind(provider: string): ProviderHookEvent["kind"] {
  return provider === "worktrunk" ? "worktree" : "harness";
}
