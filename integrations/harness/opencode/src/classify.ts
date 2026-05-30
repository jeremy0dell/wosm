import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

export function classifyOpenCodeRunStatus(run: HarnessRunObservation): HarnessStatusObservation {
  if (run.state === "needs_attention" && run.confidence === "high") {
    return observation(run, {
      value: "needs_attention",
      confidence: "high",
      reason: run.reason,
      source: "harness_event",
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
    reason: "OpenCode run has no reliable OpenCode status signal yet.",
    source: "harness_process",
    updatedAt: run.observedAt,
  });
}

export function classifyOpenCodeSkeletonRun(run: HarnessRunObservation): HarnessStatusObservation {
  return classifyOpenCodeRunStatus(run);
}

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  return {
    provider: "opencode",
    runId: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    status,
    observedAt: status.updatedAt,
    ...(run.providerData === undefined ? {} : { providerData: run.providerData }),
  };
}
