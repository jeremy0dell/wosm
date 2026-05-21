import type { WosmConfig } from "@wosm/config";
import type { DoctorOptions, DoctorReport } from "@wosm/contracts";
import { createObserverClient } from "@wosm/protocol";
import { runRuntimeBoundaryWithTimeout } from "@wosm/runtime";
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
  const result = await runRuntimeBoundaryWithTimeout(
    {
      operation: "cli.doctor.run",
      timeoutMs: options.timeoutMs ?? 1000,
      error: {
        tag: "DoctorCommandError",
        code: "DOCTOR_RPC_FAILED",
        message: "Doctor command could not collect observer diagnostics.",
      },
      timeoutError: {
        tag: "TimeoutError",
        code: "DOCTOR_RPC_TIMEOUT",
        message: "Doctor command timed out while contacting the observer.",
      },
    },
    async () => client.runDoctor(doctorOptions),
  );
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
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
