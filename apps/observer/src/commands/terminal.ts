import type { TerminalProvider } from "@wosm/contracts";
import type { ObserverCore } from "../reconcile/core.js";
import type { CommandHandler, CommandHandlerContext } from "./queue.js";

export type CreateTerminalFocusHandlerOptions = {
  core: ObserverCore;
  terminal: TerminalProvider;
};

export function createTerminalFocusHandler(
  options: CreateTerminalFocusHandlerOptions,
): CommandHandler {
  return async (context) => {
    assertTerminalFocusCommand(context);
    throwIfAborted(context.signal);
    const targetId = resolveTerminalFocusTargetId({
      core: options.core,
      command: context.command,
      providerId: options.terminal.id,
    });
    throwIfAborted(context.signal);
    await options.terminal.focusTarget(targetId);
    throwIfAborted(context.signal);
  };
}

function resolveTerminalFocusTargetId(input: {
  core: ObserverCore;
  command: Extract<CommandHandlerContext["command"], { type: "terminal.focus" }>;
  providerId: string;
}): string {
  const payload = input.command.payload;
  if (payload.targetId !== undefined) {
    return payload.targetId;
  }

  const snapshot = input.core.getSnapshot();
  if (payload.sessionId !== undefined) {
    const session = snapshot.sessions.find((candidate) => candidate.id === payload.sessionId);
    const targetId =
      session?.terminal.primaryAgentTargetId ?? session?.terminal.workspaceTargetId ?? undefined;
    if (targetId !== undefined) {
      return targetId;
    }
  }

  if (payload.worktreeId !== undefined) {
    const row = snapshot.rows.find((candidate) => candidate.id === payload.worktreeId);
    const targetId = row?.terminal?.primaryAgentTargetId ?? row?.terminal?.workspaceTargetId;
    if (targetId !== undefined) {
      return targetId;
    }
  }

  throw terminalTargetMissingError(input.providerId, {
    ...(payload.worktreeId === undefined ? {} : { worktreeId: payload.worktreeId }),
    ...(payload.sessionId === undefined ? {} : { sessionId: payload.sessionId }),
  });
}

function terminalTargetMissingError(
  provider: string,
  context: {
    worktreeId?: string;
    sessionId?: string;
  },
) {
  return {
    tag: "TerminalProviderError",
    code: "TERMINAL_TARGET_MISSING",
    message: "No terminal is open for this worktree.",
    hint: "Start an agent or open this worktree from wosm before focusing it.",
    provider,
    ...context,
  };
}

function assertTerminalFocusCommand(
  context: CommandHandlerContext,
): asserts context is CommandHandlerContext & {
  command: Extract<CommandHandlerContext["command"], { type: "terminal.focus" }>;
} {
  if (context.command.type !== "terminal.focus") {
    throw new Error(`Expected terminal.focus command, received ${context.command.type}.`);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ?? {
        tag: "CancellationError",
        code: "COMMAND_CANCELLED",
        message: "Observer command was cancelled.",
      }
    );
  }
}
