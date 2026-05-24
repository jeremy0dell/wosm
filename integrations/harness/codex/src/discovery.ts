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
    dead: z.boolean().optional(),
    deadStatus: z.string().min(1).optional(),
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
    if (isDefinitelyNotCodexCommand(providerData.data.currentCommand)) {
      continue;
    }
    if (!targetMatchesKnownWorktree(target, context.worktrees)) {
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

function isDefinitelyNotCodexCommand(command: string | undefined): boolean {
  if (command === undefined) {
    return false;
  }
  return new Set(["bash", "dash", "fish", "sh", "tmux", "zsh"]).has(command);
}

function targetMatchesKnownWorktree(
  target: HarnessDiscoveryContext["terminalTargets"][number],
  worktrees: HarnessDiscoveryContext["worktrees"],
): boolean {
  if (target.cwd === undefined || target.worktreeId === undefined) {
    return true;
  }
  const worktree = worktrees.find((candidate) => candidate.id === target.worktreeId);
  if (worktree === undefined) {
    return true;
  }
  return pathIsSameOrInside(target.cwd, worktree.path);
}

function pathIsSameOrInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeLocalPath(candidate);
  const normalizedRoot = normalizeLocalPath(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  if (normalizedRoot === "/") {
    return normalizedCandidate.startsWith("/");
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function normalizeLocalPath(value: string): string {
  const trimmed = value.trim();
  const withoutTrailingSlash = trimmed.length > 1 ? trimmed.replace(/\/+$/g, "") : trimmed;
  return withoutTrailingSlash.startsWith("/private/var/")
    ? `/var/${withoutTrailingSlash.slice("/private/var/".length)}`
    : withoutTrailingSlash;
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
