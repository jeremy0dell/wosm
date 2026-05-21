import type { WosmConfig } from "@wosm/config";
import type { HookReceipt, ProviderHookEvent, SafeError } from "@wosm/contracts";
import { ProviderHookEventSchema, WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { createObserverClient } from "@wosm/protocol";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithTimeout,
  safeErrorFromUnknown,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { writeHookSpoolRecord } from "./hookSpool.js";
import { type ObserverProcessDeps, startObserver } from "./observerProcess.js";
import { type ObserverPaths, resolveObserverPaths } from "./paths.js";

export type HookReceiverInput = {
  provider: string;
  event: string;
  kind?: ProviderHookEvent["kind"];
  payload?: unknown;
  config?: WosmConfig | undefined;
  paths?: ObserverPaths | undefined;
  autoStart?: boolean | undefined;
  deliveryTimeoutMs?: number | undefined;
  startupTimeoutMs?: number | undefined;
  rateLimitMs?: number | undefined;
};

export type HookReceiverDeps = ObserverProcessDeps & {
  clientFactory?: (socketPath: string) => ReturnType<typeof createObserverClient>;
  clock?: RuntimeClock;
  writeSpool?: typeof writeHookSpoolRecord;
};

const lastStartByStateDir = new Map<string, number>();

export async function receiveHookEvent(
  input: HookReceiverInput,
  deps: HookReceiverDeps = {},
): Promise<HookReceipt> {
  const clock = deps.clock ?? systemClock;
  const paths = input.paths ?? resolveObserverPaths(input.config);
  const event = ProviderHookEventSchema.parse({
    schemaVersion: WOSM_SCHEMA_VERSION,
    provider: input.provider,
    kind: input.kind ?? inferHookKind(input.provider),
    event: input.event,
    receivedAt: toIsoTimestamp(clock.now()),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
  const deliveryTimeoutMs = input.deliveryTimeoutMs ?? 750;
  const startupTimeoutMs = input.startupTimeoutMs ?? 1500;
  const rateLimitMs = input.rateLimitMs ?? 2000;
  const autoStart = input.autoStart ?? input.config?.observer?.autoStartFromHooks !== false;

  const onlineDelivery = await deliverHook(paths, event, deliveryTimeoutMs, deps);
  if (onlineDelivery.ok && onlineDelivery.value.status === "ingested") {
    return onlineDelivery.value;
  }

  const deliveryError = onlineDelivery.ok ? onlineDelivery.value.error : onlineDelivery.error;

  if (autoStart) {
    const startResult = await maybeStartObserver({
      paths,
      config: input.config,
      timeoutMs: startupTimeoutMs,
      rateLimitMs,
      deps,
    });
    if (startResult.ok) {
      const retryDelivery = await deliverHook(paths, event, deliveryTimeoutMs, deps);
      if (retryDelivery.ok && retryDelivery.value.status === "ingested") {
        return retryDelivery.value;
      }
      return spool(
        paths,
        event,
        retryDelivery.ok ? retryDelivery.value.error : retryDelivery.error,
        deps,
      );
    }
    return spool(paths, event, startResult.error, deps);
  }

  return spool(paths, event, deliveryError, deps);
}

async function deliverHook(
  paths: ObserverPaths,
  event: ProviderHookEvent,
  timeoutMs: number,
  deps: HookReceiverDeps,
) {
  return runRuntimeBoundaryWithTimeout(
    {
      operation: "cli.hook.deliver",
      clock: deps.clock,
      timeoutMs,
      error: {
        tag: "HookDeliveryError",
        code: "HOOK_DELIVERY_FAILED",
        message: "Hook event could not be delivered to the observer.",
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

async function maybeStartObserver(input: {
  paths: ObserverPaths;
  config?: WosmConfig | undefined;
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

  const started = await startObserver(
    {
      config: input.config,
      paths: input.paths,
      timeoutMs: input.timeoutMs,
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

function defaultClientFactory(socketPath: string) {
  return createObserverClient({ socketPath, timeoutMs: 500 });
}

function inferHookKind(provider: string): ProviderHookEvent["kind"] {
  return provider === "worktrunk" ? "worktree" : "harness";
}
