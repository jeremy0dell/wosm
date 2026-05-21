import type { WosmConfig } from "@wosm/config";
import type { DoctorOptions, DoctorReport } from "@wosm/contracts";
import { createObserverClient } from "@wosm/protocol";
import {
  type ObserverProcessDeps,
  type ObserverStatus,
  startObserver,
} from "../observerProcess.js";
import { resolveObserverPaths } from "../paths.js";

export type DoctorCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  timeoutMs?: number | undefined;
};

export async function runDoctorCommand(
  args: string[],
  options: DoctorCommandOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<DoctorReport> {
  const doctorOptions = parseDoctorOptions(args);
  const paths = resolveObserverPaths(options.config);
  const status = await startObserver({ ...options, paths }, deps);
  assertRunning(status);
  const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
  return client.runDoctor(doctorOptions);
}

function parseDoctorOptions(args: string[]): DoctorOptions {
  const result: NonNullable<DoctorOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--deep") {
      result.deep = true;
      continue;
    }
    if (arg === "--project" && args[index + 1] !== undefined) {
      result.projectId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown doctor option: ${arg}`);
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function assertRunning(
  status: ObserverStatus,
): asserts status is Extract<ObserverStatus, { status: "running" }> {
  if (status.status !== "running") {
    throw new Error(status.error?.message ?? "Observer is not running.");
  }
}

function defaultClientFactory(socketPath: string) {
  return createObserverClient({ socketPath, timeoutMs: 500 });
}
