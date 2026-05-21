import type { WosmConfig } from "@wosm/config";
import type { ObserverHealth, ObserverStopReceipt } from "@wosm/contracts";
import {
  getObserverStatus,
  type ObserverProcessDeps,
  type ObserverStatus,
  restartObserver,
  startObserver,
  stopObserver,
} from "../observerProcess.js";
import { type ObserverPaths, resolveObserverPaths } from "../paths.js";

export type ObserverCommandResult =
  | ObserverStatus
  | ObserverStopReceipt
  | {
      status: "foreground-exited";
      code: number;
      paths: ObserverPaths;
    };

export type ObserverCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  timeoutMs?: number | undefined;
};

export async function runObserverCommand(
  args: string[],
  options: ObserverCommandOptions = {},
  deps: ObserverProcessDeps = {},
): Promise<ObserverCommandResult> {
  const action = args[0] ?? "status";
  const paths = resolveObserverPaths(options.config);

  switch (action) {
    case "status":
      return getObserverStatus({ ...options, paths }, deps);
    case "start":
      return startObserver({ ...options, paths }, deps);
    case "stop":
      return stopObserver({ ...options, paths }, deps);
    case "restart":
      return restartObserver({ ...options, paths }, deps);
    case "run": {
      const { runObserverMain } = await import("@wosm/observer");
      const code = await runObserverMain([
        "--socket",
        paths.socketPath,
        "--state-dir",
        paths.stateDir,
        ...(options.configPath === undefined ? [] : ["--config", options.configPath]),
      ]);
      return {
        status: "foreground-exited",
        code,
        paths,
      };
    }
    default:
      throw new Error(`Unknown observer command: ${action}`);
  }
}

export function observerCommandSummary(result: ObserverCommandResult): unknown {
  if ("health" in result) {
    return {
      status: result.status,
      socketPath: result.paths.socketPath,
      health: result.health satisfies ObserverHealth,
    };
  }
  if ("paths" in result) {
    return result;
  }
  return result satisfies ObserverStopReceipt;
}
