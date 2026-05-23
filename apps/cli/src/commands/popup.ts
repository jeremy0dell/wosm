import type { WosmConfig } from "@wosm/config";
import { openTmuxPopup, type TmuxPopupOptions, type TmuxPopupResult } from "@wosm/tmux";

export type PopupCommandDeps = Pick<
  TmuxPopupOptions,
  "enterWorkbench" | "env" | "runner" | "tuiCommand"
>;

export type PopupCommandOptions = {
  config?: WosmConfig | undefined;
  timeoutMs?: number | undefined;
  runner?: TmuxPopupOptions["runner"] | undefined;
  enterWorkbench?: TmuxPopupOptions["enterWorkbench"] | undefined;
  env?: TmuxPopupOptions["env"] | undefined;
  tuiCommand?: TmuxPopupOptions["tuiCommand"] | undefined;
};

export async function runPopupCommand(
  args: string[],
  options: PopupCommandOptions = {},
  deps: PopupCommandDeps = {},
): Promise<TmuxPopupResult> {
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
  const tuiCommand = options.tuiCommand ?? deps.tuiCommand;
  return openTmuxPopup({
    ...(options.config?.terminal?.tmux === undefined
      ? {}
      : { config: options.config.terminal.tmux }),
    enterWorkbench,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(env === undefined ? {} : { env }),
    ...(runner === undefined ? {} : { runner }),
    ...(tuiCommand === undefined ? {} : { tuiCommand }),
  });
}
