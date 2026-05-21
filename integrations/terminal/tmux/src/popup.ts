import type { TmuxConfig } from "@wosm/config";
import {
  type ExternalCommandRunner,
  runExternalCommand,
  runRuntimeBoundaryWithRetryAndTimeout,
} from "@wosm/runtime";
import { tmuxProviderErrorFromUnknown } from "./errors.js";
import { resolveTmuxWorkbenchConfig } from "./topology.js";

export type TmuxPopupOptions = {
  command?: string;
  config?: TmuxConfig;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
  tuiCommand?: string;
};

export type TmuxPopupResult = {
  opened: true;
};

export function buildTmuxPopupArgs(
  options: { config?: TmuxConfig; tuiCommand?: string } = {},
): string[] {
  const config = resolveTmuxWorkbenchConfig(options.config);
  const args = ["display-popup", "-w", config.popupWidth, "-h", config.popupHeight];
  if (config.popupPosition.length > 0 && config.popupPosition !== "C") {
    args.push("-x", config.popupPosition);
  }
  args.push("-E", options.tuiCommand ?? "wosm tui --popup");
  return args;
}

export async function openTmuxPopup(options: TmuxPopupOptions = {}): Promise<TmuxPopupResult> {
  const command = options.command ?? process.env.WOSM_TMUX_BIN ?? "tmux";
  const args = buildTmuxPopupArgs({
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(options.tuiCommand === undefined ? {} : { tuiCommand: options.tuiCommand }),
  });
  const result = await runRuntimeBoundaryWithRetryAndTimeout(
    {
      operation: "provider.tmux.popup",
      timeoutMs: options.timeoutMs ?? 5000,
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_POPUP_FAILED",
        message: "tmux failed to open the wosm popup.",
        provider: "tmux",
      },
      timeoutError: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TMUX_TIMEOUT",
        message: "tmux popup command timed out.",
        provider: "tmux",
      },
      retry: {
        retries: 0,
      },
    },
    ({ signal }) =>
      runExternalCommand(
        {
          command,
          args,
          signal,
          maxOutputChars: 64 * 1024,
        },
        options.runner,
      ),
  );

  if (!result.ok) {
    throw tmuxProviderErrorFromUnknown(result.error, {
      code: "TERMINAL_OPEN_FAILED",
      message: "tmux failed to open the wosm popup.",
    });
  }

  return { opened: true };
}
