import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

export function classifyCursorRunStatus(run: HarnessRunObservation): HarnessStatusObservation {
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
      source: "harness_event",
      updatedAt: run.observedAt,
    });
  }

  return observation(run, {
    value: "unknown",
    confidence: "low",
    reason: "Cursor run has no reliable Cursor hook status signal yet.",
    source: "harness_process",
    updatedAt: run.observedAt,
  });
}

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  const output: HarnessStatusObservation = {
    provider: "cursor",
    runId: run.id,
    status,
    observedAt: status.updatedAt,
  };
  if (run.projectId !== undefined) output.projectId = run.projectId;
  if (run.worktreeId !== undefined) output.worktreeId = run.worktreeId;
  if (run.sessionId !== undefined) output.sessionId = run.sessionId;
  if (run.providerData !== undefined) output.providerData = run.providerData;
  return output;
}
