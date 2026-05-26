import type {
  HarnessEventReportResult,
  HookPayloadSummary,
  HookScopeDecision,
  ProviderHookAdapter,
  ProviderHookEvent,
  ProviderHookPayloadCompactionResult,
} from "@wosm/contracts";
import { ProviderHookEventSchema } from "@wosm/contracts";

export function findProviderHookAdapter(
  provider: string,
  adapters: readonly ProviderHookAdapter[] = [],
): ProviderHookAdapter | undefined {
  return adapters.find((adapter) => adapter.provider === provider);
}

export function inferProviderHookKind(
  provider: string,
  adapters: readonly ProviderHookAdapter[] = [],
): ProviderHookEvent["kind"] {
  return findProviderHookAdapter(provider, adapters)?.kind ?? "harness";
}

export function normalizeProviderHookEventName(
  provider: string,
  event: string,
  adapters: readonly ProviderHookAdapter[] = [],
): string {
  const normalize = findProviderHookAdapter(provider, adapters)?.normalizeEventName;
  return normalize === undefined ? event : normalize(event);
}

export function enrichProviderHookPayload(input: {
  provider: string;
  payload: unknown;
  env: Record<string, string | undefined>;
  adapters?: readonly ProviderHookAdapter[] | undefined;
}): unknown {
  const enrich = findProviderHookAdapter(input.provider, input.adapters)?.enrichPayload;
  return enrich === undefined ? input.payload : enrich({ payload: input.payload, env: input.env });
}

export function decideProviderHookScope(
  event: ProviderHookEvent,
  adapters: readonly ProviderHookAdapter[] = [],
): HookScopeDecision {
  return (
    findProviderHookAdapter(event.provider, adapters)?.decideScope?.(event) ?? {
      action: "accept",
      reason: "not-required",
    }
  );
}

export function compactProviderHookEventPayload(
  event: ProviderHookEvent,
  adapters: readonly ProviderHookAdapter[] = [],
): ProviderHookPayloadCompactionResult {
  if (event.payload === undefined) {
    return {
      event,
      payloadSummary: {
        present: false,
        originalBytes: null,
        compactedBytes: null,
        compacted: false,
        omittedFieldNames: [],
      },
    };
  }

  const compact = findProviderHookAdapter(event.provider, adapters)?.compactPayload;
  if (compact === undefined) {
    return genericPayloadCompaction(event);
  }

  const compacted = compact(event);
  return {
    event: ProviderHookEventSchema.parse(compacted.event),
    payloadSummary: compacted.payloadSummary,
  };
}

export function shouldReportHarnessEvent(
  event: ProviderHookEvent,
  adapters: readonly ProviderHookAdapter[] = [],
): boolean {
  return (
    event.kind === "harness" &&
    findProviderHookAdapter(event.provider, adapters)?.toHarnessEventReport !== undefined
  );
}

export function harnessEventReportFromHookEvent(
  event: ProviderHookEvent,
  payloadSummary: HookPayloadSummary,
  fallbackReportId: () => string,
  adapters: readonly ProviderHookAdapter[] = [],
): HarnessEventReportResult {
  const mapper = findProviderHookAdapter(event.provider, adapters)?.toHarnessEventReport;
  if (mapper === undefined) {
    return {
      ok: false,
      error: new Error(`Unsupported harness event report provider: ${event.provider}`),
    };
  }

  return mapper({ event, payloadSummary, fallbackReportId });
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

function genericPayloadCompaction(event: ProviderHookEvent): ProviderHookPayloadCompactionResult {
  const byteCount = jsonByteCount(event.payload);
  return {
    event,
    payloadSummary: {
      present: true,
      originalBytes: byteCount,
      compactedBytes: byteCount,
      compacted: false,
      omittedFieldNames: [],
    },
  };
}
