import {
  actionNeedsYes,
  capitalize,
  hookCommandExitCode,
  loadedCommandOptions,
} from "../cliCommand/helpers.js";
import type { CliCommandNode, CliCommandRunContext } from "../cliCommand/types.js";
import { runWorktrunkHooksCommand } from "../worktrunkHooks.js";

export const worktrunkCliCommand: CliCommandNode = {
  name: "worktrunk",
  description: "Manage Worktrunk-specific lifecycle hook helpers.",
  requiresConfig: true,
  usage: ["wosm worktrunk hooks plan|install|uninstall|doctor [options]"],
  examples: ["pnpm wosm worktrunk hooks doctor", "pnpm wosm worktrunk hooks plan"],
  children: [
    {
      name: "hooks",
      description: "Plan, install, uninstall, or doctor Worktrunk hooks.",
      run: runWorktrunkHooksCliCommand,
      usage: [
        "wosm worktrunk hooks plan [options]",
        "wosm worktrunk hooks install --yes [options]",
        "wosm worktrunk hooks uninstall --yes [options]",
        "wosm worktrunk hooks doctor [options]",
      ],
      options: [
        { name: "--yes, -y", description: "Confirm install or uninstall actions." },
        {
          name: "--worktrunk-config <path>",
          description: "Use a specific Worktrunk config file.",
        },
        { name: "--hook-bin <command>", description: "Use a specific wosm-ingress command." },
      ],
      examples: ["pnpm wosm worktrunk hooks doctor", "pnpm wosm worktrunk hooks install --yes"],
      children: ["plan", "install", "uninstall", "doctor"].map((action) =>
        worktrunkHookActionCommand(action),
      ),
    },
  ],
};

async function runWorktrunkHooksCliCommand(context: CliCommandRunContext) {
  const result = await runWorktrunkHooksCommand(context.args, loadedCommandOptions(context));
  return { code: hookCommandExitCode(result), output: result };
}

function worktrunkHookActionCommand(action: string): CliCommandNode {
  return {
    name: action,
    description: `${capitalize(action)} Worktrunk lifecycle hooks.`,
    usage: [`wosm worktrunk hooks ${action}${actionNeedsYes(action) ? " --yes" : ""} [options]`],
    options: [
      { name: "--yes, -y", description: "Required for install and uninstall actions." },
      { name: "--worktrunk-config <path>", description: "Use a specific Worktrunk config file." },
      { name: "--hook-bin <command>", description: "Use a specific wosm-ingress command." },
    ],
    examples: [`pnpm wosm worktrunk hooks ${action}${actionNeedsYes(action) ? " --yes" : ""}`],
  };
}
