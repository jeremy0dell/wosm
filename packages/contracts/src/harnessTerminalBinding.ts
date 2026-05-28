import { normalize as normalizePath } from "node:path";
import { z } from "zod";
import type {
  HarnessRunObservation,
  TerminalTargetObservation,
  WorktreeObservation,
} from "./observations.js";

const nonEmptyStringSchema = z.string().min(1);

export const TerminalHarnessBindingProviderDataSchema = z
  .object({
    sessionId: nonEmptyStringSchema.optional(),
    windowId: nonEmptyStringSchema.optional(),
    paneId: nonEmptyStringSchema.optional(),
    role: nonEmptyStringSchema.optional(),
    harness: nonEmptyStringSchema.optional(),
    currentCommand: nonEmptyStringSchema.optional(),
    attached: z.boolean().optional(),
    dead: z.boolean().optional(),
    deadStatus: nonEmptyStringSchema.optional(),
    worktreePath: nonEmptyStringSchema.optional(),
  })
  .strict();

export type TerminalHarnessBindingProviderData = z.infer<
  typeof TerminalHarnessBindingProviderDataSchema
>;

export function parseTerminalHarnessBindingProviderData(
  providerData: unknown,
): TerminalHarnessBindingProviderData | undefined {
  const result = TerminalHarnessBindingProviderDataSchema.safeParse(providerData);
  return result.success ? result.data : undefined;
}

export function terminalTargetMatchesHarnessBinding(input: {
  target: TerminalTargetObservation;
  harnessProvider: string;
  role?: string | undefined;
}): TerminalHarnessBindingProviderData | undefined {
  const binding = parseTerminalHarnessBindingProviderData(input.target.providerData);
  if (binding === undefined || binding.harness !== input.harnessProvider) {
    return undefined;
  }
  if (input.role !== undefined && binding.role !== input.role) {
    return undefined;
  }
  return binding;
}

export function terminalTargetMatchesKnownWorktree(
  target: TerminalTargetObservation,
  worktrees: readonly WorktreeObservation[],
): boolean {
  if (target.cwd === undefined || target.worktreeId === undefined) {
    return true;
  }
  const worktree = worktrees.find((candidate) => candidate.id === target.worktreeId);
  if (worktree === undefined) {
    return true;
  }
  return observedPathIsSameOrInside(target.cwd, worktree.path);
}

export function isDefinitelyShellCommand(command: string | undefined): boolean {
  if (command === undefined) {
    return false;
  }
  return new Set(["bash", "dash", "fish", "sh", "tmux", "zsh"]).has(command);
}

export function harnessRunIdForTerminalTarget(
  harnessProvider: string,
  terminalTargetId: string,
): string {
  return `${harnessProvider}:${terminalTargetId}`;
}

export function terminalHarnessRunProviderData(
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

export function terminalBoundHarnessRunObservation(input: {
  harnessProvider: string;
  target: TerminalTargetObservation;
  currentCommand: string | undefined;
  reason: string;
}): HarnessRunObservation {
  const run: HarnessRunObservation = {
    id:
      input.target.harnessRunId ??
      harnessRunIdForTerminalTarget(input.harnessProvider, input.target.id),
    provider: input.harnessProvider,
    state: "unknown",
    confidence: "low",
    reason: input.reason,
    observedAt: input.target.observedAt,
    providerData: terminalHarnessRunProviderData(
      input.target.provider,
      input.target.id,
      input.currentCommand,
    ),
  };
  if (input.target.projectId !== undefined) {
    run.projectId = input.target.projectId;
  }
  if (input.target.worktreeId !== undefined) {
    run.worktreeId = input.target.worktreeId;
  }
  if (input.target.sessionId !== undefined) {
    run.sessionId = input.target.sessionId;
  }
  if (input.target.pid !== undefined) {
    run.pid = input.target.pid;
  }
  if (input.target.cwd !== undefined) {
    run.cwd = input.target.cwd;
  }
  return run;
}

export function observedPathIsSameOrInside(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeObservedPath(candidate);
  const normalizedRoot = normalizeObservedPath(root);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  if (normalizedRoot === "/") {
    return normalizedCandidate.startsWith("/");
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export function sameObservedPath(left: string, right: string): boolean {
  return normalizeObservedPath(left) === normalizeObservedPath(right);
}

export function normalizeObservedPath(value: string): string {
  const normalized = normalizePath(value.trim());
  const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/g, "") : normalized;
  return withoutTrailingSlash.startsWith("/private/var/")
    ? `/var/${withoutTrailingSlash.slice("/private/var/".length)}`
    : withoutTrailingSlash;
}
