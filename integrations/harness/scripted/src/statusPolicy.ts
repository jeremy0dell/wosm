import type { HarnessRunObservation, HarnessStatusObservation } from "@wosm/contracts";
import {
  parseScriptedAgentEvent,
  type ScriptedAgentEvent,
  statusFromScriptedEvent,
} from "./events.js";

export type ScriptedStatusPolicyOptions = {
  now?: string;
  recentActivityMs?: number;
};

export function classifyScriptedRunStatus(
  run: HarnessRunObservation,
  options: ScriptedStatusPolicyOptions = {},
): HarnessStatusObservation {
  const now = options.now ?? new Date().toISOString();
  const events = scriptedEventsFromRun(run).sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  );
  const latest = events.at(-1);

  if (latest === undefined) {
    return observation(run, {
      value: "unknown",
      confidence: "low",
      reason: "Scripted run has no reliable lifecycle event.",
      source: "unknown",
      updatedAt: now,
    });
  }

  if (latest.type === "activity" && !isRecent(latest.at, now, options.recentActivityMs ?? 30_000)) {
    return observation(run, {
      value: "unknown",
      confidence: "low",
      reason: "Scripted activity is stale and no completion signal was observed.",
      source: "unknown",
      updatedAt: latest.at,
    });
  }

  return observation(run, statusFromScriptedEvent(latest, latest.at));
}

export function scriptedEventsFromRun(run: HarnessRunObservation): ScriptedAgentEvent[] {
  if (!isRecord(run.providerData)) {
    return [];
  }
  const events = run.providerData.events;
  if (!Array.isArray(events)) {
    return [];
  }
  return events.map((event) => parseScriptedAgentEvent(event));
}

function observation(
  run: HarnessRunObservation,
  status: HarnessStatusObservation["status"],
): HarnessStatusObservation {
  return {
    provider: run.provider,
    runId: run.id,
    ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
    ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    status,
    observedAt: status.updatedAt,
    ...(run.providerData === undefined ? {} : { providerData: run.providerData }),
  };
}

function isRecent(at: string, now: string, recentActivityMs: number): boolean {
  return Date.parse(now) - Date.parse(at) <= recentActivityMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
