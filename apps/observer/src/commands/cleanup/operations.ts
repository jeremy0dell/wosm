import type {
  HarnessProvider,
  HarnessRunId,
  SafeError,
  SessionView,
  TerminalProvider,
  TerminalTargetId,
  WorktreeRow,
} from "@wosm/contracts";
import type { RuntimeClock } from "@wosm/runtime";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { CommandHandlerContext } from "../queue.js";
import { runProviderMutation, throwIfAborted } from "../session/shared.js";
import { isRunningAgentState } from "./guards.js";
import {
  resolveHarnessProviderOrThrow,
  terminalTargetIdForRow,
  terminalTargetIdForSession,
} from "./resolve.js";

export type CleanupRuntime = {
  clock?: RuntimeClock | undefined;
  commandTimeoutMs?: number | undefined;
};

export async function closeSessionResources(
  input: {
    providers: ProviderRegistry;
    session: SessionView;
    row?: WorktreeRow | undefined;
    mode: "harness" | "terminal" | "all";
    force: boolean;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  if (input.mode === "harness" || input.mode === "all") {
    await stopHarnessForSession(input);
  }
  throwIfAborted(input.context.signal);

  if (input.mode === "terminal" || input.mode === "all") {
    const targetId = terminalTargetIdForSession(input.session) ?? terminalTargetIdForRow(input.row);
    if (targetId === undefined) {
      const error: SafeError = {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_MISSING",
        message: "No terminal is open for this session.",
        hint: "Refresh the dashboard and retry.",
        provider: input.providers.terminal.id,
        sessionId: input.session.id,
        worktreeId: input.session.worktreeId,
      };
      throw error;
    }
    await closeTerminalTarget({
      terminal: input.providers.terminal,
      targetId,
      context: input.context,
      clock: input.clock,
      commandTimeoutMs: input.commandTimeoutMs,
    });
  }
}

export async function stopHarnessForWorktree(
  input: {
    providers: ProviderRegistry;
    row: WorktreeRow;
    force: boolean;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  if (input.row.agent === undefined || !isRunningAgentState(input.row.agent.state)) {
    return;
  }
  const provider = resolveHarnessProviderOrThrow(input.providers, input.row.agent.harness);
  await stopHarnessRun({
    provider,
    runId: input.row.agent.runId,
    sessionId: input.row.agent.sessionId,
    worktreeId: input.row.id,
    force: input.force,
    context: input.context,
    clock: input.clock,
    commandTimeoutMs: input.commandTimeoutMs,
  });
}

export async function closeTerminalForWorktree(
  input: {
    terminal: TerminalProvider;
    row: WorktreeRow;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  const targetId = terminalTargetIdForRow(input.row);
  if (targetId === undefined) {
    return;
  }
  await closeTerminalTarget({
    terminal: input.terminal,
    targetId,
    context: input.context,
    clock: input.clock,
    commandTimeoutMs: input.commandTimeoutMs,
  });
}

export async function closeTerminalTarget(
  input: {
    terminal: TerminalProvider;
    targetId: TerminalTargetId;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  await runProviderMutation(
    {
      operation: `provider.${input.terminal.id}.closeTarget`,
      clock: input.clock,
      commandTimeoutMs: input.commandTimeoutMs,
      signal: input.context.signal,
      trace: input.context.trace,
      fallback: {
        tag: "TerminalProviderError",
        code: "TERMINAL_CLOSE_FAILED",
        message: "The terminal provider failed to close the target.",
        provider: input.terminal.id,
      },
      timeoutFallback: {
        tag: "TimeoutError",
        code: "TERMINAL_CLOSE_TIMEOUT",
        message: "The terminal provider timed out while closing the target.",
        provider: input.terminal.id,
      },
    },
    () => input.terminal.closeTarget(input.targetId),
  );
}

export async function removeWorktreeThroughProvider(
  input: {
    providers: ProviderRegistry;
    row: WorktreeRow;
    force: boolean;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  const request = {
    worktreeId: input.row.id,
    projectId: input.row.projectId,
  };
  const providerRequest: typeof request & { force?: boolean } = { ...request };
  if (input.force) {
    providerRequest.force = true;
  }
  const result = await runProviderMutation(
    {
      operation: `provider.${input.providers.worktree.id}.removeWorktree`,
      clock: input.clock,
      commandTimeoutMs: input.commandTimeoutMs,
      signal: input.context.signal,
      trace: input.context.trace,
      fallback: {
        tag: "WorktreeProviderError",
        code: "WORKTREE_REMOVE_FAILED",
        message: "The worktree provider failed to remove the worktree.",
        provider: input.providers.worktree.id,
      },
      timeoutFallback: {
        tag: "TimeoutError",
        code: "WORKTREE_REMOVE_TIMEOUT",
        message: "The worktree provider timed out while removing the worktree.",
        provider: input.providers.worktree.id,
      },
    },
    () => input.providers.worktree.removeWorktree(providerRequest),
  );

  if (!result.removed) {
    const error: SafeError = {
      tag: "WorktreeProviderError",
      code: "WORKTREE_REMOVE_NOT_CONFIRMED",
      message: "The worktree provider did not confirm removal.",
      provider: input.providers.worktree.id,
      projectId: input.row.projectId,
      worktreeId: input.row.id,
    };
    throw error;
  }
}

async function stopHarnessForSession(
  input: {
    providers: ProviderRegistry;
    session: SessionView;
    row?: WorktreeRow | undefined;
    force: boolean;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  if (!isRunningAgentState(input.row?.agent?.state ?? input.session.status.value)) {
    return;
  }
  const providerId = input.row?.agent?.harness ?? input.session.harness.provider;
  const runId = input.row?.agent?.runId ?? input.session.harness.runId;
  const provider = resolveHarnessProviderOrThrow(input.providers, providerId);
  await stopHarnessRun({
    provider,
    runId,
    sessionId: input.session.id,
    worktreeId: input.session.worktreeId,
    force: input.force,
    context: input.context,
    clock: input.clock,
    commandTimeoutMs: input.commandTimeoutMs,
  });
}

async function stopHarnessRun(
  input: {
    provider: HarnessProvider;
    runId: HarnessRunId | undefined;
    sessionId?: string | undefined;
    worktreeId: string;
    force: boolean;
    context: CommandHandlerContext;
  } & CleanupRuntime,
): Promise<void> {
  if (input.runId === undefined) {
    const error: SafeError = {
      tag: "HarnessProviderError",
      code: "HARNESS_RUN_MISSING",
      message: "The active harness run could not be resolved for cleanup.",
      provider: input.provider.id,
      worktreeId: input.worktreeId,
    };
    if (input.sessionId !== undefined) error.sessionId = input.sessionId;
    throw error;
  }
  if (input.provider.stop === undefined) {
    const error: SafeError = {
      tag: "HarnessProviderError",
      code: "HARNESS_STOP_UNSUPPORTED",
      message: "The harness provider cannot stop runs.",
      provider: input.provider.id,
      worktreeId: input.worktreeId,
    };
    if (input.sessionId !== undefined) error.sessionId = input.sessionId;
    throw error;
  }
  const request = { runId: input.runId };
  const stopRequest: typeof request & { sessionId?: string; force?: boolean } = { ...request };
  if (input.sessionId !== undefined) stopRequest.sessionId = input.sessionId;
  if (input.force) stopRequest.force = true;
  await runProviderMutation(
    {
      operation: `provider.${input.provider.id}.stop`,
      clock: input.clock,
      commandTimeoutMs: input.commandTimeoutMs,
      signal: input.context.signal,
      trace: input.context.trace,
      fallback: {
        tag: "HarnessProviderError",
        code: "HARNESS_STOP_FAILED",
        message: "The harness provider failed to stop the run.",
        provider: input.provider.id,
      },
      timeoutFallback: {
        tag: "TimeoutError",
        code: "HARNESS_STOP_TIMEOUT",
        message: "The harness provider timed out while stopping the run.",
        provider: input.provider.id,
      },
    },
    () => input.provider.stop?.(stopRequest) as Promise<unknown>,
  );
}
