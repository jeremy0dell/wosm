import type { WosmConfig } from "@wosm/config";
import { openTmuxPopup, type TmuxPopupOptions, type TmuxPopupResult } from "@wosm/tmux";

export type PopupCommandDeps = Pick<TmuxPopupOptions, "runner">;

export type PopupCommandOptions = {
  config?: WosmConfig | undefined;
  timeoutMs?: number | undefined;
  runner?: TmuxPopupOptions["runner"] | undefined;
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
  return openTmuxPopup({
    ...(options.config?.terminal?.tmux === undefined
      ? {}
      : { config: options.config.terminal.tmux }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(runner === undefined ? {} : { runner }),
  });
}
