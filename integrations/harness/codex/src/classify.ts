import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

export function classifyCodexRunStatus(run: HarnessRunObservation): HarnessStatusObservation {
  if (run.state === "needs_attention" && run.confidence === "high") {
    return observation(run, {
      value: "needs_attention",
      confidence: "high",
      reason: run.reason,
      source: "harness_hook",
      updatedAt: run.observedAt,
    });
  }

  if (run.state === "exited" && run.confidence === "high") {
    return observation(run, {
      value: "exited",
      confidence: "high",
      reason: run.reason,
      source: "harness_process",
      updatedAt: run.observedAt,
    });
  }

  return observation(run, {
    value: "unknown",
    confidence: "low",
    reason: "Codex run has no reliable Codex status signal yet.",
    source: "harness_process",
    updatedAt: run.observedAt,
  });
}

export function classifyCodexSkeletonRun(run: HarnessRunObservation): HarnessStatusObservation {
  return classifyCodexRunStatus(run);
}

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  return {
    provider: "codex",
    runId: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    status,
    observedAt: status.updatedAt,
    ...(run.providerData === undefined ? {} : { providerData: run.providerData }),
  };
}
