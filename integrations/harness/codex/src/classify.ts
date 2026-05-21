import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

export function classifyCodexSkeletonRun(run: HarnessRunObservation): HarnessStatusObservation {
  return {
    provider: "codex",
    runId: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    status: {
      value: "unknown",
      confidence: "low",
      reason: "Codex skeleton has no reliable status signal yet.",
      source: "unknown",
      updatedAt: run.observedAt,
    },
    observedAt: run.observedAt,
  };
}
