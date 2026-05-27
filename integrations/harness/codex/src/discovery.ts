import type { HarnessDiscoveryContext, HarnessRunObservation } from "@wosm/contracts";
import {
  isDefinitelyShellCommand,
  terminalBoundHarnessRunObservation,
  terminalTargetMatchesHarnessBinding,
  terminalTargetMatchesKnownWorktree,
} from "@wosm/contracts";

export function discoverCodexRuns(context: HarnessDiscoveryContext): HarnessRunObservation[] {
  const runs: HarnessRunObservation[] = [];
  for (const target of context.terminalTargets) {
    const binding = terminalTargetMatchesHarnessBinding({
      target,
      harnessProvider: "codex",
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
        harnessProvider: "codex",
        target,
        currentCommand: binding.currentCommand,
        reason: "terminal target is bound to Codex; no reliable lifecycle signal yet.",
      }),
    );
  }
  return runs;
}
