import { codexHookPayloadToHarnessEventReport } from "@wosm/codex";
import type { HarnessEventReport, ProviderHookEvent } from "@wosm/contracts";

export type HookPayloadSummary = {
  present: boolean;
  originalBytes: number | null;
  compactedBytes: number | null;
  compacted: boolean;
  omittedFieldNames: string[];
};

export type HarnessEventReportResult =
  | {
      ok: true;
      report: HarnessEventReport;
    }
  | {
      ok: false;
      error: unknown;
    };

export function shouldReportHarnessEvent(event: ProviderHookEvent): boolean {
  return event.kind === "harness" && event.provider === "codex";
}

export function harnessEventReportFromHookEvent(
  event: ProviderHookEvent,
  payloadSummary: HookPayloadSummary,
  fallbackReportId: () => string,
): HarnessEventReportResult {
  if (event.provider !== "codex") {
    return {
      ok: false,
      error: new Error(`Unsupported harness event report provider: ${event.provider}`),
    };
  }

  try {
    return {
      ok: true,
      report: codexHookPayloadToHarnessEventReport({
        reportId: event.hookId ?? fallbackReportId(),
        observedAt: event.receivedAt,
        payload: event.payload,
        diagnostics: {
          payloadBytes: payloadSummary.originalBytes,
          compactedBytes: payloadSummary.compactedBytes,
          compacted: payloadSummary.compacted,
          truncated: false,
          omittedFieldNames: payloadSummary.omittedFieldNames,
        },
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}
