import type {
  SafeError,
  SessionView,
  TerminalTargetId,
  WorktreeRow,
  WosmSnapshot,
} from "@wosm/contracts";
import { worktreeMissingError as createWorktreeMissingError } from "../errors.js";

type TerminalTargetPayload = {
  targetId?: string | undefined;
  sessionId?: string | undefined;
  worktreeId?: string | undefined;
};

export type ResolvedTerminalTarget = {
  targetId: TerminalTargetId;
  session?: SessionView;
  row?: WorktreeRow;
};

export function resolveSessionOrThrow(snapshot: WosmSnapshot, sessionId: string): SessionView {
  const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
  if (session !== undefined) {
    return session;
  }
  throw sessionMissingError(sessionId);
}

export function resolveWorktreeRowOrThrow(
  snapshot: WosmSnapshot,
  worktreeId: string,
  projectId?: string,
): WorktreeRow {
  const row = snapshot.rows.find((candidate) => candidate.id === worktreeId);
  if (row === undefined) {
    throw worktreeMissingError(worktreeId, projectId);
  }
  if (projectId !== undefined && row.projectId !== projectId) {
    const error: SafeError = {
      tag: "CommandValidationError",
      code: "WORKTREE_PROJECT_MISMATCH",
      message: "The requested worktree belongs to a different configured project.",
      projectId,
      worktreeId,
    };
    throw error;
  }
  return row;
}

export function resolveRowForSession(
  snapshot: WosmSnapshot,
  session: SessionView,
): WorktreeRow | undefined {
  return snapshot.rows.find((candidate) => candidate.id === session.worktreeId);
}

export function resolveTerminalTargetOrThrow(input: {
  snapshot: WosmSnapshot;
  payload: TerminalTargetPayload;
  providerId: string;
}): ResolvedTerminalTarget {
  const payload = input.payload;
  if (payload.targetId !== undefined) {
    const session = input.snapshot.sessions.find(
      (candidate) =>
        candidate.terminal.primaryAgentTargetId === payload.targetId ||
        candidate.terminal.workspaceTargetId === payload.targetId,
    );
    const row = input.snapshot.rows.find(
      (candidate) =>
        candidate.terminal?.primaryAgentTargetId === payload.targetId ||
        candidate.terminal?.workspaceTargetId === payload.targetId,
    );
    const resolved: ResolvedTerminalTarget = { targetId: payload.targetId };
    if (session !== undefined) resolved.session = session;
    if (row !== undefined) resolved.row = row;
    return resolved;
  }

  if (payload.sessionId !== undefined) {
    const session = resolveSessionOrThrow(input.snapshot, payload.sessionId);
    const row = resolveRowForSession(input.snapshot, session);
    const targetId = terminalTargetIdForSession(session) ?? terminalTargetIdForRow(row);
    if (targetId !== undefined) {
      const resolved: ResolvedTerminalTarget = { targetId, session };
      if (row !== undefined) resolved.row = row;
      return resolved;
    }
    throw terminalTargetMissingError(input.providerId, {
      sessionId: session.id,
      worktreeId: session.worktreeId,
    });
  }

  if (payload.worktreeId !== undefined) {
    const row = resolveWorktreeRowOrThrow(input.snapshot, payload.worktreeId);
    const session =
      row.agent?.sessionId === undefined
        ? undefined
        : input.snapshot.sessions.find((candidate) => candidate.id === row.agent?.sessionId);
    const targetId = terminalTargetIdForRow(row) ?? terminalTargetIdForSession(session);
    if (targetId !== undefined) {
      const resolved: ResolvedTerminalTarget = { targetId, row };
      if (session !== undefined) resolved.session = session;
      return resolved;
    }
    throw terminalTargetMissingError(input.providerId, {
      worktreeId: row.id,
      ...(row.agent?.sessionId === undefined ? {} : { sessionId: row.agent.sessionId }),
    });
  }

  throw terminalTargetMissingError(input.providerId, {});
}

export function terminalTargetIdForSession(
  session: SessionView | undefined,
): TerminalTargetId | undefined {
  return session?.terminal.primaryAgentTargetId ?? session?.terminal.workspaceTargetId;
}

export function terminalTargetIdForRow(row: WorktreeRow | undefined): TerminalTargetId | undefined {
  return row?.terminal?.primaryAgentTargetId ?? row?.terminal?.workspaceTargetId;
}

export function sessionMissingError(sessionId: string): SafeError {
  return {
    tag: "CommandValidationError",
    code: "SESSION_NOT_FOUND",
    message: "The requested session is not visible in the observer snapshot.",
    hint: "Refresh the dashboard and retry.",
    sessionId,
  };
}

export function worktreeMissingError(worktreeId: string, projectId?: string): SafeError {
  return createWorktreeMissingError({
    worktreeId,
    projectId,
    message: "The requested worktree is not visible in the observer snapshot.",
    hint: "Refresh the dashboard and retry.",
  });
}

export function terminalTargetMissingError(
  provider: string,
  context: {
    worktreeId?: string;
    sessionId?: string;
  },
): SafeError {
  const error: SafeError = {
    tag: "TerminalProviderError",
    code: "TERMINAL_TARGET_MISSING",
    message: "No terminal is open for this worktree.",
    hint: "Start an agent or open this worktree from wosm before focusing it.",
    provider,
  };
  if (context.worktreeId !== undefined) error.worktreeId = context.worktreeId;
  if (context.sessionId !== undefined) error.sessionId = context.sessionId;
  return error;
}
