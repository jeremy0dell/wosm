import type { HarnessDiscoveryContext, HarnessRunObservation } from "@wosm/contracts";
import {
  isDefinitelyShellCommand,
  terminalBoundHarnessRunObservation,
  terminalTargetMatchesHarnessBinding,
  terminalTargetMatchesKnownWorktree,
} from "@wosm/contracts";

export function discoverOpenCodeRuns(context: HarnessDiscoveryContext): HarnessRunObservation[] {
  const runs: HarnessRunObservation[] = [];
  for (const target of context.terminalTargets) {
    const binding = terminalTargetMatchesHarnessBinding({
      target,
      harnessProvider: "opencode",
      role: "main-agent",
    });
    if (binding === undefined) {
      continue;
    }
    if (isDefinitelyShellCommand(binding.currentCommand)) {
      continue;
    }
    if (!terminalTargetMatchesKnownWorktree(target, context.worktrees)) {
      continue;
    }

    runs.push(
      terminalBoundHarnessRunObservation({
        harnessProvider: "opencode",
        target,
        currentCommand: binding.currentCommand,
        reason: "terminal target is bound to OpenCode; no reliable lifecycle signal yet.",
      }),
    );
  }
  return runs;
}
