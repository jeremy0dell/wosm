import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";

export function classifyPiRunStatus(run: HarnessRunObservation): HarnessStatusObservation {
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
    reason: "Pi run has no reliable Pi status signal yet.",
    source: "harness_process",
    updatedAt: run.observedAt,
  });
}

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  const output: HarnessStatusObservation = {
    provider: "pi",
    runId: run.id,
    status,
    observedAt: status.updatedAt,
  };
  if (run.projectId !== undefined) {
    output.projectId = run.projectId;
  }
  if (run.worktreeId !== undefined) {
    output.worktreeId = run.worktreeId;
  }
  if (run.sessionId !== undefined) {
    output.sessionId = run.sessionId;
  }
  if (run.providerData !== undefined) {
    output.providerData = run.providerData;
  }
  return output;
}
