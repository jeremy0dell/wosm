import type { ObserverPaths } from "@wosm/config";
import type {
  HookPayloadSummary,
  HookReceipt,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import { safeErrorFromUnknown, systemClock } from "@wosm/runtime";
import {
  type ProviderHookObserverStartupDeps,
  startProviderHookObserver,
} from "./observerStartup.js";

export type ProviderDeliveryAttempt = {
  receipt?: HookReceipt;
  error?: SafeError;
};

export type ProviderDeliveryPolicyDeps = ProviderHookObserverStartupDeps;

type ReceiptRecorder = (input: {
  paths: ObserverPaths;
  event: ProviderHookEvent;
  payloadSummary: HookPayloadSummary;
  receipt: HookReceipt;
}) => HookReceipt | Promise<HookReceipt>;

const lastStartByStateDir = new Map<string, number>();

export async function deliverProviderHookWithSpooling(input: {
  paths: ObserverPaths;
  event: ProviderHookEvent;
  payloadSummary: HookPayloadSummary;
  autoStart: boolean;
  startupTimeoutMs: number;
  rateLimitMs: number;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  deps: ProviderDeliveryPolicyDeps;
  deliver: () => Promise<ProviderDeliveryAttempt>;
  spoolReceipt: (error: SafeError | undefined) => Promise<HookReceipt>;
  recordReceipt?: ReceiptRecorder | undefined;
}): Promise<HookReceipt> {
  const firstDelivery = await input.deliver();
  if (firstDelivery.receipt !== undefined) {
    return recordReceipt(input, firstDelivery.receipt);
  }

  if (input.autoStart) {
    const startResult = await maybeStartObserver({
      paths: input.paths,
      configPath: input.configPath,
      observerEntryPath: input.observerEntryPath,
      timeoutMs: input.startupTimeoutMs,
      rateLimitMs: input.rateLimitMs,
      deps: input.deps,
    });
    if (startResult.ok) {
      const retryDelivery = await input.deliver();
      if (retryDelivery.receipt !== undefined) {
        return recordReceipt(input, retryDelivery.receipt);
      }
      return recordReceipt(input, await input.spoolReceipt(retryDelivery.error));
    }
    return recordReceipt(input, await input.spoolReceipt(startResult.error));
  }

  return recordReceipt(input, await input.spoolReceipt(firstDelivery.error));
}

async function recordReceipt(
  input: {
    paths: ObserverPaths;
    event: ProviderHookEvent;
    payloadSummary: HookPayloadSummary;
    recordReceipt?: ReceiptRecorder | undefined;
  },
  receipt: HookReceipt,
): Promise<HookReceipt> {
  if (input.recordReceipt === undefined) {
    return receipt;
  }
  return input.recordReceipt({
    paths: input.paths,
    event: input.event,
    payloadSummary: input.payloadSummary,
    receipt,
  });
}

async function maybeStartObserver(input: {
  paths: ObserverPaths;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  timeoutMs: number;
  rateLimitMs: number;
  deps: ProviderDeliveryPolicyDeps;
}) {
  const now = (input.deps.clock ?? systemClock).now().getTime();
  const lastStart = lastStartByStateDir.get(input.paths.stateDir) ?? 0;
  if (now - lastStart < input.rateLimitMs) {
    return {
      ok: false as const,
      error: safeErrorFromUnknown(undefined, {
        tag: "HookAutoStartRateLimitError",
        code: "HOOK_AUTOSTART_RATE_LIMITED",
        message: "Observer auto-start from provider hooks is rate-limited.",
      }),
    };
  }
  lastStartByStateDir.set(input.paths.stateDir, now);

  const started = await startProviderHookObserver(
    {
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
        message: "Observer could not be started for provider hook delivery.",
      }),
  };
}
