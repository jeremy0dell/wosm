import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HarnessEventReportSpoolRecord,
  HookReceipt,
  HookSpoolRecord,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import {
  HarnessEventReportReceiptSchema,
  HarnessEventReportSpoolRecordSchema,
  HookReceiptSchema,
  HookSpoolRecordSchema,
  WOSM_SCHEMA_VERSION,
} from "@wosm/contracts";
import { type RuntimeClock, runRuntimeBoundary, systemClock, toIsoTimestamp } from "@wosm/runtime";

export type WriteHookSpoolRecordOptions = {
  spoolDir: string;
  event: ProviderHookEvent;
  error?: SafeError;
  clock?: RuntimeClock;
  spoolId?: () => string;
};

export type WriteHarnessEventReportSpoolRecordOptions = {
  spoolDir: string;
  report: HarnessEventReport;
  error?: SafeError;
  clock?: RuntimeClock;
  spoolId?: () => string;
};

const defaultSpoolId = () => `spool_${Date.now()}_${randomUUID()}`;

export async function writeHookSpoolRecord(
  options: WriteHookSpoolRecordOptions,
): Promise<HookReceipt> {
  const clock = options.clock ?? systemClock;
  const spoolId = (options.spoolId ?? defaultSpoolId)();
  const result = await runRuntimeBoundary(
    {
      operation: "providerHooks.hookSpool.write",
      clock,
      error: {
        tag: "HookSpoolError",
        code: "HOOK_SPOOL_WRITE_FAILED",
        message: "Hook event could not be written to the hook spool.",
        provider: options.event.provider,
      },
    },
    async () => {
      await mkdir(options.spoolDir, { recursive: true, mode: 0o700 });
      await chmod(options.spoolDir, 0o700);

      const record: HookSpoolRecord = HookSpoolRecordSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        spoolId,
        createdAt: toIsoTimestamp(clock.now()),
        event: options.event,
        attempts: 0,
        ...(options.error === undefined ? {} : { lastError: options.error }),
      });
      await writeFile(join(options.spoolDir, `${spoolId}.json`), JSON.stringify(record, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    },
  );

  if (!result.ok) {
    throw result.error;
  }

  return HookReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    hookId: options.event.hookId ?? spoolId,
    provider: options.event.provider,
    event: options.event.event,
    accepted: true,
    status: "spooled",
    receivedAt: options.event.receivedAt,
    spooled: true,
    ...(options.error === undefined ? {} : { error: options.error }),
  });
}

export async function writeHarnessEventReportSpoolRecord(
  options: WriteHarnessEventReportSpoolRecordOptions,
): Promise<HarnessEventReportReceipt> {
  const clock = options.clock ?? systemClock;
  const spoolId = (options.spoolId ?? defaultSpoolId)();
  const result = await runRuntimeBoundary(
    {
      operation: "providerHooks.harnessEventReportSpool.write",
      clock,
      error: {
        tag: "HookSpoolError",
        code: "HOOK_REPORT_SPOOL_WRITE_FAILED",
        message: "Harness event report could not be written to the hook spool.",
        provider: options.report.provider,
      },
    },
    async () => {
      await mkdir(options.spoolDir, { recursive: true, mode: 0o700 });
      await chmod(options.spoolDir, 0o700);

      const record: HarnessEventReportSpoolRecord = HarnessEventReportSpoolRecordSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        spoolId,
        createdAt: toIsoTimestamp(clock.now()),
        report: options.report,
        attempts: 0,
        ...(options.error === undefined ? {} : { lastError: options.error }),
      });
      await writeFile(join(options.spoolDir, `${spoolId}.json`), JSON.stringify(record, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    },
  );

  if (!result.ok) {
    throw result.error;
  }

  return HarnessEventReportReceiptSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    reportId: options.report.reportId,
    provider: options.report.provider,
    eventType: options.report.eventType,
    accepted: true,
    status: "spooled",
    receivedAt: options.report.observedAt,
    projected: false,
    scheduledReconcile: false,
    ...(options.error === undefined ? {} : { error: options.error }),
  });
}
