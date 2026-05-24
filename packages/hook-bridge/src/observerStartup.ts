import { type ChildProcess, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WosmConfig } from "@wosm/config";
import type { ObserverHealth, SafeError } from "@wosm/contracts";
import { createObserverClient, isSocketStale, removeStaleSocket } from "@wosm/protocol";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithRetryAndTimeout,
  runRuntimeBoundaryWithTimeout,
  safeErrorFromUnknown,
  systemClock,
} from "@wosm/runtime";
import { type ObserverPaths, resolveObserverPaths } from "./paths.js";

export type HookObserverStatus =
  | {
      status: "running";
      paths: ObserverPaths;
      health: ObserverHealth;
    }
  | {
      status: "stopped" | "stale" | "unhealthy";
      paths: ObserverPaths;
      error?: SafeError;
    };

export type HookObserverStartupDeps = {
  clientFactory?: (socketPath: string) => ReturnType<typeof createObserverClient>;
  spawnObserver?: (input: SpawnHookObserverInput) => ChildProcessLike | Promise<ChildProcessLike>;
  clock?: RuntimeClock;
  sleep?: (ms: number) => Promise<void>;
};

export type SpawnHookObserverInput = {
  paths: ObserverPaths;
  observerEntryPath?: string;
  configPath?: string;
};

export type ChildProcessLike = Pick<ChildProcess, "pid" | "unref"> & {
  kill?: ChildProcess["kill"];
};

export type HookObserverStartupOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  observerEntryPath?: string | undefined;
  paths?: ObserverPaths | undefined;
  timeoutMs?: number | undefined;
};

export async function getHookObserverStatus(
  options: HookObserverStartupOptions = {},
  deps: HookObserverStartupDeps = {},
): Promise<HookObserverStatus> {
  const paths = options.paths ?? resolveObserverPaths(options.config);
  if (await isSocketStale(paths.socketPath)) {
    return { status: "stale", paths };
  }

  const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
  try {
    return {
      status: "running",
      paths,
      health: await client.health(),
    };
  } catch (error) {
    return {
      status: "stopped",
      paths,
      error: safeErrorFromUnknown(error, {
        tag: "ObserverConnectionError",
        code: "OBSERVER_NOT_RUNNING",
        message: "Observer is not running.",
      }),
    };
  }
}

export async function startHookObserver(
  options: HookObserverStartupOptions = {},
  deps: HookObserverStartupDeps = {},
): Promise<HookObserverStatus> {
  const paths = options.paths ?? resolveObserverPaths(options.config);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const clock = deps.clock ?? systemClock;
  const existing = await getHookObserverStatus({ ...options, paths }, deps);
  if (existing.status === "running") {
    return existing;
  }
  if (existing.status === "stale") {
    await removeStaleSocket(paths.socketPath);
  }

  let child: ChildProcessLike | undefined;
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: "hookBridge.observer.start",
      clock,
      timeoutMs,
      error: {
        tag: "ObserverStartupError",
        code: "OBSERVER_START_FAILED",
        message: "Observer startup failed.",
      },
      timeoutError: {
        tag: "ObserverStartupError",
        code: "OBSERVER_START_FAILED",
        message: "Observer did not become healthy before the startup timeout.",
      },
    },
    async () => {
      await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
      await mkdir(dirname(paths.socketPath), { recursive: true, mode: 0o700 });
      const spawnInput: SpawnHookObserverInput = { paths };
      if (options.observerEntryPath !== undefined) {
        spawnInput.observerEntryPath = options.observerEntryPath;
      }
      if (options.configPath !== undefined) {
        spawnInput.configPath = options.configPath;
      }
      child = await (deps.spawnObserver ?? defaultSpawnObserver)(spawnInput);
      child.unref?.();
      return waitForHookObserverHealth({ paths, timeoutMs }, deps);
    },
  );

  if (result.ok) {
    return {
      status: "running",
      paths,
      health: result.value,
    };
  }

  child?.kill?.();
  return {
    status: "unhealthy",
    paths,
    error: result.error,
  };
}

export async function waitForHookObserverHealth(
  options: { paths: ObserverPaths; timeoutMs?: number },
  deps: HookObserverStartupDeps = {},
): Promise<ObserverHealth> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const client = (deps.clientFactory ?? defaultClientFactory)(options.paths.socketPath);
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "hookBridge.observer.waitForHealth",
      timeoutMs,
      error: {
        tag: "ObserverStartupError",
        code: "OBSERVER_HEALTH_FAILED",
        message: "Observer health check failed.",
      },
      timeoutError: {
        tag: "ObserverStartupError",
        code: "OBSERVER_HEALTH_TIMEOUT",
        message: "Observer did not report healthy before the timeout.",
      },
      retry: {
        retries: Math.max(1, Math.ceil(timeoutMs / 25)),
        delayMs: 25,
      },
    },
    async () => client.health(),
  );

  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

function defaultClientFactory(socketPath: string) {
  return createObserverClient({ socketPath, timeoutMs: 500 });
}

function defaultSpawnObserver(input: SpawnHookObserverInput): ChildProcessLike {
  if (input.observerEntryPath === undefined || input.observerEntryPath.length === 0) {
    throw new Error("observerEntryPath is required to auto-start observer from hooks");
  }
  const args = [
    input.observerEntryPath,
    "--socket",
    input.paths.socketPath,
    "--state-dir",
    input.paths.stateDir,
    ...(input.configPath === undefined ? [] : ["--config", input.configPath]),
  ];
  return spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
  });
}
