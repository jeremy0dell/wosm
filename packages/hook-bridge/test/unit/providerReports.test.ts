import type { HarnessEventReport, ProviderHookAdapter, ProviderHookEvent } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import {
  type HookPayloadSummary,
  harnessEventReportFromHookEvent,
  shouldReportHarnessEvent,
} from "../../src/providerReports";

const now = "2026-05-20T12:00:00.000Z";
const reportAdapter: ProviderHookAdapter = {
  provider: "fake-harness",
  kind: "harness",
  toHarnessEventReport: ({ event, payloadSummary, fallbackReportId }) => {
    const diagnostics: NonNullable<HarnessEventReport["diagnostics"]> = {
      rawEventType: event.event,
      compacted: payloadSummary.compacted,
      omittedFieldNames: payloadSummary.omittedFieldNames,
    };
    if (payloadSummary.originalBytes !== null) {
      diagnostics.payloadBytes = payloadSummary.originalBytes;
    }
    if (payloadSummary.compactedBytes !== null) {
      diagnostics.compactedBytes = payloadSummary.compactedBytes;
    }

    return {
      ok: true,
      report: {
        schemaVersion: "0.3.0",
        reportId: event.hookId ?? fallbackReportId(),
        provider: event.provider,
        kind: "harness",
        eventType: event.event,
        observedAt: event.receivedAt,
        diagnostics,
      },
    };
  },
};

describe("hook bridge provider report mapping", () => {
  it("uses injected adapters as the only report-producing harness mappers", () => {
    expect(shouldReportHarnessEvent(hookEvent("fake-harness", "run.updated", {}), [])).toBe(false);
    expect(
      shouldReportHarnessEvent(hookEvent("fake-harness", "run.updated", {}), [reportAdapter]),
    ).toBe(true);
    expect(
      shouldReportHarnessEvent(hookEvent("other-harness", "run.updated", {}), [reportAdapter]),
    ).toBe(false);
  });

  it("maps harness hooks into provider-neutral reports through the injected adapter", () => {
    const result = harnessEventReportFromHookEvent(
      hookEvent("fake-harness", "permission.requested", { value: "payload" }),
      payloadSummary(),
      () => "report_fallback",
      [reportAdapter],
    );

    expect(result).toMatchObject({
      ok: true,
      report: {
        reportId: "hook_1",
        provider: "fake-harness",
        kind: "harness",
        eventType: "permission.requested",
        diagnostics: {
          rawEventType: "permission.requested",
          payloadBytes: 1024,
          compactedBytes: 256,
          compacted: true,
          omittedFieldNames: ["tool_input"],
        },
      },
    });
  });

  it("returns a typed result when no adapter can report the provider event", () => {
    const result = harnessEventReportFromHookEvent(
      hookEvent("other-harness", "run.updated", {}),
      payloadSummary(),
      () => "report_fallback",
      [reportAdapter],
    );

    expect(result.ok).toBe(false);
  });
});

function hookEvent(provider: string, event: string, payload: unknown): ProviderHookEvent {
  return {
    schemaVersion: "0.3.0",
    hookId: "hook_1",
    provider,
    kind: "harness",
    event,
    receivedAt: now,
    payload,
  };
}

function payloadSummary(): HookPayloadSummary {
  return {
    present: true,
    originalBytes: 1024,
    compactedBytes: 256,
    compacted: true,
    omittedFieldNames: ["tool_input"],
  };
}
