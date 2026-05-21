import type { WosmConfig } from "@wosm/config";
import { type RunTuiOptions, runTui, type TuiRunResult } from "@wosm/tui";
import {
  type ObserverProcessDeps,
  type ObserverStatus,
  startObserver,
} from "../observerProcess.js";
import { type ObserverPaths, resolveObserverPaths } from "../paths.js";

export type TuiCommandDeps = {
  observer?: ObserverProcessDeps;
  runTui?: (options: RunTuiOptions) => Promise<TuiRunResult>;
};

export type TuiCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  timeoutMs?: number | undefined;
};

export type TuiCommandResult =
  | TuiRunResult
  | {
      status: "unavailable";
      code: 1;
      paths: ObserverPaths;
      observer: ObserverStatus;
    };

export async function runTuiCommand(
  args: string[],
  options: TuiCommandOptions = {},
  deps: TuiCommandDeps = {},
): Promise<TuiCommandResult> {
  const parsed = parseTuiArgs(args, options.timeoutMs);
  const paths = resolveObserverPaths(options.config);
  const observer = await startObserver(
    {
      ...options,
      paths,
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
    },
    deps.observer,
  );
  if (observer.status !== "running") {
    return {
      status: "unavailable",
      code: 1,
      paths,
      observer,
    };
  }

  return (deps.runTui ?? runTui)({ socketPath: observer.paths.socketPath });
}

function parseTuiArgs(args: string[], timeoutMs: number | undefined): { timeoutMs?: number } {
  let parsedTimeoutMs = timeoutMs;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--popup") {
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--timeout-ms requires a value.");
      }
      parsedTimeoutMs = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown tui option: ${arg ?? ""}`);
  }

  const result: { timeoutMs?: number } = {};
  if (parsedTimeoutMs !== undefined) {
    result.timeoutMs = parsedTimeoutMs;
  }
  return result;
}
