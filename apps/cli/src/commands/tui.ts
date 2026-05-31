import type { WosmConfig } from "@wosm/config";
import type { TerminalFocusOrigin } from "@wosm/contracts";
import { createObserverClient } from "@wosm/protocol";
import { dismissTmuxPopup, resolveTmuxPopupFocusOrigin } from "@wosm/tmux";
import { type RunTuiOptions, runTui, type TuiRunResult } from "@wosm/tui";
import { createFakeDashboardSnapshot, createFakeTuiObserverService } from "@wosm/tui/dev";
import { parsePositiveIntegerOption } from "../args.js";
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
  popupLifecycle?: {
    resolveFocusOrigin?: RunTuiOptions["resolveFocusOrigin"];
    onFocusSuccess?: RunTuiOptions["onFocusSuccess"];
    onDismiss?: RunTuiOptions["onDismiss"];
  };
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
  if (parsed.devFakeDashboard) {
    const snapshot = createFakeDashboardSnapshot({
      projectCount: parsed.fakeProjects,
      worktreesPerProject: parsed.fakeWorktreesPerProject,
    });
    const runOptions: RunTuiOptions = {
      initialSnapshot: snapshot,
      service: createFakeTuiObserverService(snapshot),
    };
    applyPopupOptions(parsed, runOptions, deps);
    return (deps.runTui ?? runTui)(runOptions);
  }

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

  const startupReconcile = {
    paths: observer.paths,
    deps: deps.observer,
    timeoutMs: parsed.timeoutMs,
  };
  if (parsed.popupMode) {
    scheduleReconcileBeforeTui(startupReconcile);
  } else {
    await reconcileBeforeTui(startupReconcile);
  }
  const runOptions: RunTuiOptions = { socketPath: observer.paths.socketPath };
  applyPopupOptions(parsed, runOptions, deps);
  return (deps.runTui ?? runTui)(runOptions);
}

function applyPopupOptions(
  parsed: ParsedTuiArgs,
  runOptions: RunTuiOptions,
  deps: TuiCommandDeps,
): void {
  if (!parsed.popupMode) {
    return;
  }
  const env = deps.env ?? process.env;
  if (parsed.persistentPopup) {
    const dismissPopup =
      deps.popupLifecycle?.onDismiss ?? (() => dismissTmuxPopup({ env }).then(() => undefined));
    runOptions.persistentPopup = true;
    runOptions.resolveFocusOrigin =
      deps.popupLifecycle?.resolveFocusOrigin ?? (() => resolveTmuxPopupFocusOrigin({ env }));
    runOptions.onFocusSuccess = deps.popupLifecycle?.onFocusSuccess ?? dismissPopup;
    runOptions.onDismiss = dismissPopup;
    return;
  }
  runOptions.exitOnFocusSuccess = true;
  const focusOrigin = focusOriginFromEnv(env);
  if (focusOrigin !== undefined) {
    runOptions.focusOrigin = focusOrigin;
  }
}

function scheduleReconcileBeforeTui(input: {
  paths: ObserverPaths;
  deps?: ObserverProcessDeps | undefined;
  timeoutMs?: number | undefined;
}): void {
  const timer = setTimeout(() => {
    void reconcileBeforeTui(input).catch(() => undefined);
  }, 250);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
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

type ParsedTuiArgs = {
  devFakeDashboard: boolean;
  fakeProjects: number;
  fakeWorktreesPerProject: number;
  popupMode: boolean;
  persistentPopup: boolean;
  timeoutMs?: number;
};

function parseTuiArgs(args: string[], timeoutMs: number | undefined): ParsedTuiArgs {
  const parsed = takeTimeoutOption(args, timeoutMs);
  const fakeProjects = takePositiveIntegerFlag(parsed.args, "--fake-projects");
  const fakeWorktreesPerProject = takePositiveIntegerFlag(
    fakeProjects.args,
    "--fake-worktrees-per-project",
  );
  const remainingArgs = fakeWorktreesPerProject.args;
  const knownFlags = new Set(["--popup", "--persistent", "--dev-fake-dashboard"]);
  const unknown = remainingArgs.find((arg) => !knownFlags.has(arg));
  if (unknown !== undefined) {
    throw new Error(`Unknown tui option: ${unknown}`);
  }
  const devFakeDashboard = remainingArgs.includes("--dev-fake-dashboard");
  if (!devFakeDashboard && fakeProjects.value !== undefined) {
    throw new Error("--fake-projects requires --dev-fake-dashboard.");
  }
  if (!devFakeDashboard && fakeWorktreesPerProject.value !== undefined) {
    throw new Error("--fake-worktrees-per-project requires --dev-fake-dashboard.");
  }
  const popupMode = remainingArgs.includes("--popup");
  const persistentPopup = remainingArgs.includes("--persistent");
  if (persistentPopup && !popupMode) {
    throw new Error("--persistent requires --popup.");
  }

  const result: ParsedTuiArgs = {
    devFakeDashboard,
    fakeProjects: fakeProjects.value ?? 4,
    fakeWorktreesPerProject: fakeWorktreesPerProject.value ?? 24,
    popupMode,
    persistentPopup,
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
    timeoutMs: parsePositiveIntegerOption(value, "--timeout-ms"),
  };
}

function takePositiveIntegerFlag(args: string[], flag: string): { args: string[]; value?: number } {
  const index = args.indexOf(flag);
  if (index === -1) {
    return { args };
  }
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value.`);
  }
  return {
    args: [...args.slice(0, index), ...args.slice(index + 2)],
    value: parsePositiveIntegerOption(value, flag),
  };
}
