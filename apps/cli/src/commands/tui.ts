import type { WosmConfig } from "@wosm/config";
import type { TerminalFocusOrigin } from "@wosm/contracts";
import { createObserverClient } from "@wosm/protocol";
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
  env?: Record<string, string | undefined>;
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

  await reconcileBeforeTui({
    paths: observer.paths,
    deps: deps.observer,
    timeoutMs: parsed.timeoutMs,
  });
  const runOptions: RunTuiOptions = { socketPath: observer.paths.socketPath };
  if (parsed.popupMode) {
    runOptions.exitOnFocusSuccess = true;
  }
  const focusOrigin = focusOriginFromEnv(deps.env ?? process.env);
  if (focusOrigin !== undefined) {
    runOptions.focusOrigin = focusOrigin;
  }
  return (deps.runTui ?? runTui)(runOptions);
}

async function reconcileBeforeTui(input: {
  paths: ObserverPaths;
  deps?: ObserverProcessDeps | undefined;
  timeoutMs?: number | undefined;
}): Promise<void> {
  const client =
    input.deps?.clientFactory?.(input.paths.socketPath) ??
    createObserverClient({
      socketPath: input.paths.socketPath,
      timeoutMs: input.timeoutMs ?? 30_000,
    });
  await client.reconcile("tui-startup");
}

function parseTuiArgs(
  args: string[],
  timeoutMs: number | undefined,
): { timeoutMs?: number; popupMode: boolean } {
  const parsed = takeTimeoutOption(args, timeoutMs);
  const unknown = parsed.args.find((arg) => arg !== "--popup");
  if (unknown !== undefined) {
    throw new Error(`Unknown tui option: ${unknown}`);
  }

  const result: { timeoutMs?: number; popupMode: boolean } = {
    popupMode: parsed.args.includes("--popup"),
  };
  if (parsed.timeoutMs !== undefined) result.timeoutMs = parsed.timeoutMs;
  return result;
}

function focusOriginFromEnv(
  env: Record<string, string | undefined>,
): TerminalFocusOrigin | undefined {
  const provider = env.WOSM_FOCUS_PROVIDER;
  if (provider === undefined || provider.length === 0) {
    return undefined;
  }
  const origin: TerminalFocusOrigin = {
    provider,
  };
  const clientId = env.WOSM_FOCUS_CLIENT_ID;
  if (clientId !== undefined && clientId.length > 0) {
    origin.clientId = clientId;
  }
  return origin;
}

function takeTimeoutOption(
  args: string[],
  fallback: number | undefined,
): { args: string[]; timeoutMs?: number } {
  const index = args.indexOf("--timeout-ms");
  if (index === -1) {
    return fallback === undefined ? { args } : { args, timeoutMs: fallback };
  }
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error("--timeout-ms requires a value.");
  }
  return {
    args: [...args.slice(0, index), ...args.slice(index + 2)],
    timeoutMs: Number(value),
  };
}
