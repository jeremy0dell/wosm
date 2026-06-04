import type {
  SafeError,
  SessionView,
  TerminalCloseIntent,
  TerminalClosePayload,
  TerminalFocusIntent,
  TerminalFocusPayload,
  TerminalIntent,
  TerminalIntentReceipt,
  TerminalIntentSubject,
  WorktreeRow,
  WosmSnapshot,
} from "@wosm/contracts";
import type { ProviderRegistry } from "../providers/registry.js";
import { resolveRowForSession } from "./cleanup/resolve.js";
import type { CommandHandlerContext } from "./queue.js";

export function terminalFocusIntentFromPayload(input: {
  providers: ProviderRegistry;
  commandId: string;
  payload: TerminalFocusPayload;
  snapshot?: WosmSnapshot | undefined;
}): TerminalFocusIntent {
  const intent: TerminalFocusIntent = {
    type: "terminal.focus",
    commandId: input.commandId,
    terminalProvider: input.providers.terminal.id,
    subject: terminalIntentSubjectFromPayload(input.payload, input.snapshot),
  };
  if (input.payload.origin !== undefined) {
    intent.origin = input.payload.origin;
  }
  return intent;
}

export function terminalCloseIntentFromPayload(input: {
  providers: ProviderRegistry;
  commandId: string;
  payload: TerminalClosePayload;
  snapshot?: WosmSnapshot | undefined;
}): TerminalCloseIntent {
  const intent: TerminalCloseIntent = {
    type: "terminal.close",
    commandId: input.commandId,
    terminalProvider: input.providers.terminal.id,
    subject: terminalIntentSubjectFromPayload(input.payload, input.snapshot),
  };
  if (input.payload.force !== undefined) {
    intent.force = input.payload.force;
  }
  return intent;
}

export function terminalCloseIntentForSession(input: {
  providers: ProviderRegistry;
  commandId: string;
  session: SessionView;
  row?: WorktreeRow | undefined;
  force: boolean;
}): TerminalCloseIntent {
  const intent: TerminalCloseIntent = {
    type: "terminal.close",
    commandId: input.commandId,
    terminalProvider: input.providers.terminal.id,
    subject: terminalIntentSubjectForSession(input.session, input.row),
  };
  if (input.force) {
    intent.force = true;
  }
  return intent;
}

export function terminalCloseIntentForWorktree(input: {
  providers: ProviderRegistry;
  commandId: string;
  row: WorktreeRow;
  force: boolean;
}): TerminalCloseIntent {
  const intent: TerminalCloseIntent = {
    type: "terminal.close",
    commandId: input.commandId,
    terminalProvider: input.providers.terminal.id,
    subject: terminalIntentSubjectForWorktree(input.row),
  };
  if (input.force) {
    intent.force = true;
  }
  return intent;
}

export async function submitTerminalIntentOrThrow(input: {
  providers: ProviderRegistry;
  intent: TerminalIntent;
  context: CommandHandlerContext;
  commandTimeoutMs?: number | undefined;
}): Promise<TerminalIntentReceipt> {
  const receipt = await input.providers.terminalIntentRunner.submitIntent(input.intent, {
    signal: input.context.signal,
    trace: input.context.trace,
    commandTimeoutMs: input.commandTimeoutMs,
  });
  if (receipt.status === "rejected") {
    throw receipt.error;
  }
  return receipt;
}

export function terminalIntentSubjectForSession(
  session: SessionView,
  row?: WorktreeRow | undefined,
): TerminalIntentSubject {
  const subject: TerminalIntentSubject = {
    sessionId: session.id,
    worktreeId: session.worktreeId,
    projectId: session.projectId,
  };
  if (row?.id !== undefined) subject.worktreeId = row.id;
  if (row?.projectId !== undefined) subject.projectId = row.projectId;
  return subject;
}

export function terminalIntentSubjectForWorktree(row: WorktreeRow): TerminalIntentSubject {
  const subject: TerminalIntentSubject = {
    worktreeId: row.id,
    projectId: row.projectId,
  };
  if (row.agent?.sessionId !== undefined) {
    subject.sessionId = row.agent.sessionId;
  }
  return subject;
}

export function hasCloseableTerminalAttachment(input: {
  session?: SessionView | undefined;
  row?: WorktreeRow | undefined;
}): boolean {
  if (input.session?.terminal.exists === true) {
    return true;
  }
  const terminalState = input.row?.terminal?.state;
  return (
    terminalState === "open" ||
    terminalState === "detached" ||
    terminalState === "unknown" ||
    terminalState === "stale"
  );
}

function terminalIntentSubjectFromPayload(
  payload: TerminalFocusPayload | TerminalClosePayload,
  snapshot: WosmSnapshot | undefined,
): TerminalIntentSubject {
  if (payload.sessionId !== undefined) {
    if (snapshot !== undefined) {
      const session = snapshot.sessions.find((candidate) => candidate.id === payload.sessionId);
      if (session !== undefined) {
        return terminalIntentSubjectForSession(session, resolveRowForSession(snapshot, session));
      }
    }
    const subject: TerminalIntentSubject = {
      sessionId: payload.sessionId,
    };
    if (payload.worktreeId !== undefined) subject.worktreeId = payload.worktreeId;
    return subject;
  }

  if (payload.worktreeId !== undefined) {
    const row = snapshot?.rows.find((candidate) => candidate.id === payload.worktreeId);
    if (row !== undefined) {
      return terminalIntentSubjectForWorktree(row);
    }
    return {
      worktreeId: payload.worktreeId,
    };
  }

  throw terminalIntentSubjectMissingError();
}

function terminalIntentSubjectMissingError(): SafeError {
  return {
    tag: "CommandValidationError",
    code: "TERMINAL_INTENT_SUBJECT_MISSING",
    message: "Terminal commands require a session or worktree reference.",
  };
}
