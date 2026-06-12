import { loadedCommandOptions } from "../cliCommand/helpers.js";
import type { CliCommandNode, CliCommandRunContext } from "../cliCommand/types.js";
import { runSnapshotCommand } from "../snapshot.js";

export const snapshotCliCommand: CliCommandNode = {
  name: "snapshot",
  description: "Print the current observer graph snapshot.",
  requiresConfig: true,
  run: runSnapshotCliCommand,
  usage: ["wosm snapshot [--json]"],
  options: [{ name: "--json", description: "Print the raw snapshot JSON." }],
  examples: ["pnpm wosm snapshot --json"],
};

async function runSnapshotCliCommand(context: CliCommandRunContext) {
  const result = await runSnapshotCommand(
    context.args,
    loadedCommandOptions(context),
    context.options.observerDeps,
  );
  return { code: 0, output: result };
}
