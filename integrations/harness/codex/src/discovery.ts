import type { HarnessDiscoveryContext, HarnessRunObservation } from "@wosm/contracts";
import { z } from "zod";

const TmuxCodexProviderDataSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    windowId: z.string().min(1).optional(),
    paneId: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    harness: z.string().min(1).optional(),
    currentCommand: z.string().min(1).optional(),
    attached: z.boolean().optional(),
  })
  .strict();

export function discoverCodexRuns(context: HarnessDiscoveryContext): HarnessRunObservation[] {
  const runs: HarnessRunObservation[] = [];
  for (const target of context.terminalTargets) {
    const providerData = TmuxCodexProviderDataSchema.safeParse(target.providerData);
    if (!providerData.success) {
      continue;
    }
    if (providerData.data.harness !== "codex" || providerData.data.role !== "main-agent") {
      continue;
    }

    const run: HarnessRunObservation = {
      id: target.harnessRunId ?? `codex:${target.id}`,
      provider: "codex",
      state: "unknown",
      confidence: "low",
      reason: "tmux terminal target is bound to Codex; no reliable lifecycle signal yet.",
      observedAt: target.observedAt,
      providerData: runProviderData(target.provider, target.id, providerData.data.currentCommand),
    };
    if (target.projectId !== undefined) {
      run.projectId = target.projectId;
    }
    if (target.worktreeId !== undefined) {
      run.worktreeId = target.worktreeId;
    }
    if (target.sessionId !== undefined) {
      run.sessionId = target.sessionId;
    }
    if (target.pid !== undefined) {
      run.pid = target.pid;
    }
    if (target.cwd !== undefined) {
      run.cwd = target.cwd;
    }
    runs.push(run);
  }
  return runs;
}

function runProviderData(
  terminalProvider: string,
  terminalTargetId: string,
  command: string | undefined,
): Record<string, unknown> {
  const providerData: Record<string, unknown> = {
    terminalProvider,
    terminalTargetId,
  };
  if (command !== undefined) {
    providerData.process = {
      command,
    };
  }
  return providerData;
}
