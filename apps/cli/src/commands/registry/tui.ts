import { loadedCommandOptions } from "../cliCommand/helpers.js";
import type { CliCommandNode, CliCommandRunContext } from "../cliCommand/types.js";
import { runTuiCommand, type TuiCommandDeps } from "../tui.js";

export const tuiCliCommand: CliCommandNode = {
  name: "tui",
  description: "Open the fullscreen or popup TUI.",
  requiresConfig: true,
  run: runTuiCliCommand,
  usage: ["wosm tui [--popup] [--persistent]"],
  options: [
    { name: "--popup", description: "Run in popup mode." },
    {
      name: "--persistent",
      description: "Keep popup lifecycle state available for reuse.",
    },
  ],
  examples: ["pnpm wosm tui", "pnpm wosm tui --popup --persistent"],
};

async function runTuiCliCommand(context: CliCommandRunContext) {
  const tuiDeps: TuiCommandDeps = {};
  if (context.options.observerDeps !== undefined) tuiDeps.observer = context.options.observerDeps;
  if (context.options.tuiDeps?.runTui !== undefined)
    tuiDeps.runTui = context.options.tuiDeps.runTui;
  if (context.options.tuiDeps?.popupLifecycle !== undefined) {
    tuiDeps.popupLifecycle = context.options.tuiDeps.popupLifecycle;
  }
  const tuiEnv = context.options.tuiDeps?.env ?? context.options.env;
  if (tuiEnv !== undefined) tuiDeps.env = tuiEnv;
  const result = await runTuiCommand(context.args, loadedCommandOptions(context), tuiDeps);
  return { code: result.code, output: result };
}
