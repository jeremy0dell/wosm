import { type ChildProcess, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WosmConfig } from "@wosm/config";
import type { ObserverHealth, ObserverStopReceipt, SafeError } from "@wosm/contracts";
import { createObserverClient, isSocketStale, removeStaleSocket } from "@wosm/protocol";
import {
  type RuntimeClock,
  runRuntimeBoundaryWithRetryAndTimeout,
  runRuntimeBoundaryWithTimeout,
  safeErrorFromUnknown,
  systemClock,
} from "@wosm/runtime";
import { type ObserverPaths, resolveObserverPaths } from "./paths.js";

export type ObserverStatus =
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

export type ObserverProcessDeps = {
  clientFactory?: (socketPath: string) => ReturnType<typeof createObserverClient>;
  spawnObserver?: (input: SpawnObserverInput) => ChildProcessLike | Promise<ChildProcessLike>;
  clock?: RuntimeClock;
  sleep?: (ms: number) => Promise<void>;
};

export type SpawnObserverInput = {
  paths: ObserverPaths;
  configPath?: string;
};

export type ChildProcessLike = Pick<ChildProcess, "pid" | "unref"> & {
  kill?: ChildProcess["kill"];
};

export type ObserverProcessOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  paths?: ObserverPaths | undefined;
  timeoutMs?: number | undefined;
};

export async function getObserverStatus(
  options: ObserverProcessOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<ObserverStatus> {
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

export async function startObserver(
  options: ObserverProcessOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<ObserverStatus> {
  const paths = options.paths ?? resolveObserverPaths(options.config);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const clock = deps.clock ?? systemClock;
  const existing = await getObserverStatus({ ...options, paths }, deps);
  if (existing.status === "running") {
    return existing;
  }
  if (existing.status === "stale") {
    await removeStaleSocket(paths.socketPath);
  }

  // Spawning only starts the daemon; report running only after the socket health check succeeds.
  let child: ChildProcessLike | undefined;
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: "cli.observer.start",
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
      child = await (deps.spawnObserver ?? defaultSpawnObserver)({
        paths,
        ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
      });
      child.unref?.();
      return waitForObserverHealth({ paths, timeoutMs }, deps);
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

export async function stopObserver(
  options: ObserverProcessOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<ObserverStopReceipt> {
  const paths = options.paths ?? resolveObserverPaths(options.config);
  const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
  return client.stop();
}

export async function restartObserver(
  options: ObserverProcessOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<ObserverStatus> {
  const status = await getObserverStatus(options, deps);
  if (status.status === "running") {
    await stopObserver({ ...options, paths: status.paths }, deps);
  }
  return startObserver({ ...options, paths: status.paths }, deps);
}

export async function waitForObserverHealth(
  options: { paths: ObserverPaths; timeoutMs?: number },
  deps: ObserverProcessDeps = {},
): Promise<ObserverHealth> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const client = (deps.clientFactory ?? defaultClientFactory)(options.paths.socketPath);
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "cli.observer.waitForHealth",
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

function defaultSpawnObserver(input: SpawnObserverInput): ChildProcessLike {
  const observerEntry = new URL("../../observer/dist/runtime/main.js", import.meta.url);
  const args = [
    observerEntry.pathname,
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
