import type { WosmConfig } from "@wosm/config";
import { createObserverClient } from "@wosm/protocol";
import { openTmuxPopup, type TmuxPopupOptions, type TmuxPopupResult } from "@wosm/tmux";
import {
  type ObserverProcessDeps,
  type ObserverStatus,
  startObserver,
} from "../observerProcess.js";
import { type ObserverPaths, resolveObserverPaths } from "../paths.js";

export type PopupCommandDeps = Partial<
  Pick<
    TmuxPopupOptions,
    | "enterWorkbench"
    | "env"
    | "preferRegisteredDevPopup"
    | "runner"
    | "tuiCommand"
    | "uiSessionName"
  >
> & {
  observer?: ObserverProcessDeps;
  openTmuxPopup?: (options: TmuxPopupOptions) => Promise<TmuxPopupResult>;
};

export type PopupCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  timeoutMs?: number | undefined;
  runner?: TmuxPopupOptions["runner"] | undefined;
  enterWorkbench?: TmuxPopupOptions["enterWorkbench"] | undefined;
  env?: TmuxPopupOptions["env"] | undefined;
  observer?: ObserverProcessDeps | undefined;
  preferRegisteredDevPopup?: TmuxPopupOptions["preferRegisteredDevPopup"] | undefined;
  tuiCommand?: TmuxPopupOptions["tuiCommand"] | undefined;
  uiSessionName?: TmuxPopupOptions["uiSessionName"] | undefined;
};

export type PopupCommandUnavailableResult = {
  status: "unavailable";
  code: 1;
  paths: ObserverPaths;
  observer: ObserverStatus;
};

export async function runPopupCommand(
  args: string[],
  options: PopupCommandOptions = {},
  deps: PopupCommandDeps = {},
): Promise<TmuxPopupResult | PopupCommandUnavailableResult> {
  if (args.length > 0) {
    throw new Error(`Unknown popup option: ${args[0] ?? ""}`);
  }

  if (
    options.config?.defaults.terminal !== undefined &&
    options.config.defaults.terminal !== "tmux"
  ) {
    throw new Error(`Popup is only implemented for tmux, not ${options.config.defaults.terminal}.`);
  }

  const runner = options.runner ?? deps.runner;
  const enterWorkbench = options.enterWorkbench ?? deps.enterWorkbench ?? false;
  const env = options.env ?? deps.env;
  const preferRegisteredDevPopup =
    options.preferRegisteredDevPopup ?? deps.preferRegisteredDevPopup;
  const tuiCommand = options.tuiCommand ?? deps.tuiCommand;
  const uiSessionName = options.uiSessionName ?? deps.uiSessionName;
  const observer = await prepareObserverForPopup(options, options.observer ?? deps.observer);
  if (observer !== undefined) {
    return observer;
  }
  const openPopup = deps.openTmuxPopup ?? openTmuxPopup;
  return openPopup({
    ...(options.config?.terminal?.tmux === undefined
      ? {}
      : { config: options.config.terminal.tmux }),
    enterWorkbench,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(env === undefined ? {} : { env }),
    ...(preferRegisteredDevPopup === undefined ? {} : { preferRegisteredDevPopup }),
    ...(runner === undefined ? {} : { runner }),
    ...(tuiCommand === undefined ? {} : { tuiCommand }),
    ...(uiSessionName === undefined ? {} : { uiSessionName }),
  });
}

async function prepareObserverForPopup(
  options: Pick<PopupCommandOptions, "config" | "configPath" | "timeoutMs">,
  deps: ObserverProcessDeps = {},
): Promise<PopupCommandUnavailableResult | undefined> {
  if (options.config === undefined) {
    return undefined;
  }
  const paths = resolveObserverPaths(options.config);
  const observer = await startObserver(
    {
      config: options.config,
      paths,
      ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
    deps,
  );
  if (observer.status !== "running") {
    return {
      status: "unavailable",
      code: 1,
      paths,
      observer,
    };
  }

  const client =
    deps.clientFactory?.(observer.paths.socketPath) ??
    createObserverClient({
      socketPath: observer.paths.socketPath,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  void client.reconcile("popup-open").catch(() => undefined);
  return undefined;
}
