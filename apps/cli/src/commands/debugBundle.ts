import type { WosmConfig } from "@wosm/config";
import type { DebugBundleManifest, DiagnosticCollectionOptions } from "@wosm/contracts";
import { writeDebugBundle } from "@wosm/observability";
import { createObserverClient } from "@wosm/protocol";
import {
  type ObserverProcessDeps,
  type ObserverStatus,
  startObserver,
} from "../observerProcess.js";
import { resolveObserverPaths } from "../paths.js";

export type DebugBundleCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  timeoutMs?: number | undefined;
};

export type DebugBundleCommandResult = {
  bundlePath: string;
  manifest: DebugBundleManifest;
};

export async function runDebugBundleCommand(
  args: string[],
  options: DebugBundleCommandOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<DebugBundleCommandResult> {
  const collectionOptions = parseDebugBundleOptions(args);
  const paths = resolveObserverPaths(options.config);
  const status = await startObserver({ ...options, paths }, deps);
  assertRunning(status);
  const client = (deps.clientFactory ?? defaultClientFactory)(paths.socketPath);
  const snapshot = await client.collectDiagnostics(collectionOptions);
  const manifest = await writeDebugBundle({
    diagnosticsDir: paths.diagnosticsDir,
    snapshot,
  });
  return {
    bundlePath: manifest.bundlePath,
    manifest,
  };
}

function parseDebugBundleOptions(args: string[]): DiagnosticCollectionOptions {
  const result: NonNullable<DiagnosticCollectionOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project" && args[index + 1] !== undefined) {
      result.projectId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--command" && args[index + 1] !== undefined) {
      result.commandId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--since" && args[index + 1] !== undefined) {
      result.since = args[index + 1];
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      throw new Error(`Unknown debug bundle option: ${arg}`);
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
