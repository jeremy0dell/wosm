import { hookCommandExitCode, loadedCommandOptions } from "../cliCommand/helpers.js";
import type { CliCommandNode, CliCommandRunContext } from "../cliCommand/types.js";
import type { EventHooksCommandOptions } from "../eventHooks.js";
import { runEventHooksCommand } from "../eventHooks.js";

const eventHookExamples = ["notify-turn-completion"] as const;

export const eventHooksCliCommand: CliCommandNode = {
  name: "event-hooks",
  description: "Plan, install, or inspect observer event hooks.",
  requiresConfig: true,
  run: runEventHooksCliCommand,
  usage: [
    "wosm event-hooks plan notify-turn-completion [--force]",
    "wosm event-hooks install notify-turn-completion --yes [--force]",
    "wosm event-hooks doctor",
  ],
  options: [
    { name: "--yes, -y", description: "Confirm event hook installation." },
    { name: "--force", description: "Replace an installed hook even if it already matches." },
  ],
  examples: ["pnpm wosm event-hooks plan notify-turn-completion", "pnpm wosm event-hooks doctor"],
  children: [
    {
      name: "plan",
      displayName: "plan notify-turn-completion",
      description: "Preview the built-in turn-completion observer event hook.",
      topicArguments: eventHookExamples,
      usage: ["wosm event-hooks plan notify-turn-completion [--force]"],
      options: [
        {
          name: "--force",
          description: "Show the replacement block even when the hook matches.",
        },
      ],
      examples: ["pnpm wosm event-hooks plan notify-turn-completion"],
    },
    {
      name: "install",
      displayName: "install notify-turn-completion",
      description: "Install or replace the built-in turn-completion observer event hook.",
      topicArguments: eventHookExamples,
      usage: ["wosm event-hooks install notify-turn-completion --yes [--force]"],
      options: [
        { name: "--yes, -y", description: "Confirm writing the config file." },
        {
          name: "--force",
          description: "Replace an installed hook even if it already matches.",
        },
      ],
      examples: ["pnpm wosm event-hooks install notify-turn-completion --yes"],
    },
    {
      name: "doctor",
      description: "Check whether the built-in turn-completion event hook is usable.",
      usage: ["wosm event-hooks doctor"],
      examples: ["pnpm wosm event-hooks doctor"],
    },
  ],
};

async function runEventHooksCliCommand(context: CliCommandRunContext) {
  const eventHookOptions: EventHooksCommandOptions = loadedCommandOptions(context);
  if (context.options.env !== undefined) {
    eventHookOptions.env = context.options.env;
  }
  const result = await runEventHooksCommand(context.args, eventHookOptions);
  return { code: hookCommandExitCode(result), output: result };
}
