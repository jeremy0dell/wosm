import type { WosmConfig } from "@wosm/config";
import type {
  HookPayloadSummary,
  HookReceipt,
  ProviderHookEvent,
  SafeError,
} from "@wosm/contracts";
import { safeErrorFromUnknown, systemClock } from "@wosm/runtime";
import { type HookObserverStartupDeps, startHookObserver } from "./observerStartup.js";
import type { ObserverPaths } from "./paths.js";

export type ProviderDeliveryAttempt = {
  receipt?: HookReceipt;
  error?: SafeError;
};

export type ProviderDeliveryPolicyDeps = HookObserverStartupDeps;

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
  config?: WosmConfig | undefined;
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
      config: input.config,
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
  config?: WosmConfig | undefined;
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
