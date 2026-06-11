import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  return {
    provider: "claude",
    runId: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    status,
    observedAt: status.updatedAt,
    ...(run.providerData === undefined ? {} : { providerData: run.providerData }),
  };
}

export function classifyClaudeRunStatus(run: HarnessRunObservation): HarnessStatusObservation {
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
    reason: "Claude Code run has no reliable Claude status signal yet.",
    source: "harness_process",
    updatedAt: run.observedAt,
  });
}
