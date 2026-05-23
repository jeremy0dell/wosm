import type {
  AgentState,
  ProjectView,
  SessionView,
  TerminalFocusOrigin,
  WorktreeRow,
  WosmCommand,
  WosmSnapshot,
} from "@wosm/contracts";

type TerminalLayout = NonNullable<
  Extract<WosmCommand, { type: "session.create" }>["payload"]["terminal"]["layout"]
>;

export type CleanupActionKind =
  | "close-harness"
  | "close-terminal"
  | "close-all"
  | "remove-worktree";

export type CreateSessionCommandInput = {
  project: ProjectView;
  branch: string;
  initialPrompt?: string;
};

export type BuildFocusCommandOptions = {
  origin?: TerminalFocusOrigin;
};

export function buildFocusCommand(
  row: WorktreeRow,
  options: BuildFocusCommandOptions = {},
): WosmCommand {
  const payload: Extract<WosmCommand, { type: "terminal.focus" }>["payload"] = {};
  const targetId = row.terminal?.primaryAgentTargetId ?? row.terminal?.workspaceTargetId;
  if (targetId !== undefined) {
    payload.targetId = targetId;
  } else if (row.agent?.sessionId !== undefined) {
    payload.sessionId = row.agent.sessionId;
  } else {
    payload.worktreeId = row.id;
  }
  if (options.origin !== undefined) {
    payload.origin = options.origin;
  }
  return {
    type: "terminal.focus",
    payload,
  };
}

export function buildStartAgentCommand(row: WorktreeRow, project: ProjectView): WosmCommand {
  return {
    type: "session.startAgent",
    payload: {
      projectId: project.id,
      worktreeId: row.id,
      harness: {
        provider: project.defaults.harness,
      },
      terminal: {
        provider: project.defaults.terminal,
        layout: commandLayout(project.defaults.layout),
        focus: false,
      },
    },
  };
}

export function cleanupForceRequired(row: WorktreeRow, action: CleanupActionKind): boolean {
  const running = isRunningAgentState(row.agent?.state);
  if (action === "remove-worktree") {
    return row.worktree.dirty === true || running;
  }
  return running;
}

export function buildCleanupCommand(
  row: WorktreeRow,
  action: CleanupActionKind,
  force: boolean,
): WosmCommand {
  if (action === "close-harness") {
    return buildSessionCloseCommand(row, "harness", force);
  }
  if (action === "close-terminal") {
    return buildTerminalCloseCommand(row, force);
  }
  if (action === "close-all") {
    return buildSessionCloseCommand(row, "all", force);
  }
  return buildWorktreeRemoveCommand(row, force);
}

export function buildCreateSessionCommand(input: CreateSessionCommandInput): WosmCommand {
  const payload: Extract<WosmCommand, { type: "session.create" }>["payload"] = {
    projectId: input.project.id,
    branch: input.branch,
    harness: {
      provider: input.project.defaults.harness,
      mode: "interactive",
    },
    terminal: {
      provider: input.project.defaults.terminal,
      layout: commandLayout(input.project.defaults.layout),
      focus: false,
    },
  };
  if (input.initialPrompt !== undefined && input.initialPrompt.length > 0) {
    payload.initialPrompt = input.initialPrompt;
  }
  return {
    type: "session.create",
    payload,
  };
}

function commandLayout(layout: string): TerminalLayout {
  if (layout === "default" || layout === "agent-only" || layout === "agent-build-shell") {
    return layout;
  }
  return "default";
}

export function buildReconcileCommand(reason?: string): WosmCommand {
  return {
    type: "observer.reconcile",
    payload: reason === undefined ? {} : { reason },
  };
}

export function buildPrimaryCommandForRow(row: WorktreeRow, snapshot: WosmSnapshot): WosmCommand {
  if (row.agent === undefined) {
    const project = snapshot.projects.find((candidate) => candidate.id === row.projectId);
    if (project === undefined) {
      throw new Error(`Project not found for worktree ${row.id}.`);
    }
    return buildStartAgentCommand(row, project);
  }
  return buildFocusCommand(row);
}

export function canSendPromptToRow(row: WorktreeRow, sessions: readonly SessionView[]): boolean {
  const sessionId = row.agent?.sessionId;
  if (sessionId === undefined) {
    return false;
  }
  const session = sessions.find((candidate) => candidate.id === sessionId);
  return session?.harness.capabilities.canReceivePrompt === true;
}

export function buildSendPromptCommand(
  row: WorktreeRow,
  sessions: readonly SessionView[],
  prompt: string,
): WosmCommand {
  if (!canSendPromptToRow(row, sessions)) {
    throw new Error("The selected harness cannot receive prompts safely.");
  }
  const sessionId = row.agent?.sessionId;
  if (sessionId === undefined) {
    throw new Error("The selected row has no session.");
  }
  return {
    type: "session.sendPrompt",
    payload: {
      sessionId,
      prompt,
      delivery: "harness-native",
    },
  };
}

function buildSessionCloseCommand(
  row: WorktreeRow,
  mode: Extract<WosmCommand, { type: "session.close" }>["payload"]["mode"],
  force: boolean,
): WosmCommand {
  const sessionId = row.agent?.sessionId;
  if (sessionId === undefined) {
    throw new Error("The selected row has no session.");
  }
  const payload: Extract<WosmCommand, { type: "session.close" }>["payload"] = {
    sessionId,
    mode,
  };
  if (force) {
    payload.force = true;
  }
  return {
    type: "session.close",
    payload,
  };
}

function buildTerminalCloseCommand(row: WorktreeRow, force: boolean): WosmCommand {
  const payload: Extract<WosmCommand, { type: "terminal.close" }>["payload"] = {};
  const targetId = row.terminal?.primaryAgentTargetId ?? row.terminal?.workspaceTargetId;
  if (targetId !== undefined) {
    payload.targetId = targetId;
  } else if (row.agent?.sessionId !== undefined) {
    payload.sessionId = row.agent.sessionId;
  } else {
    payload.worktreeId = row.id;
  }
  if (force) {
    payload.force = true;
  }
  return {
    type: "terminal.close",
    payload,
  };
}

function buildWorktreeRemoveCommand(row: WorktreeRow, force: boolean): WosmCommand {
  const payload: Extract<WosmCommand, { type: "worktree.remove" }>["payload"] = {
    projectId: row.projectId,
    worktreeId: row.id,
  };
  if (force) {
    payload.force = true;
  }
  return {
    type: "worktree.remove",
    payload,
  };
}

function isRunningAgentState(state: AgentState | undefined): boolean {
  return (
    state === "starting" ||
    state === "idle" ||
    state === "working" ||
    state === "needs_attention" ||
    state === "stuck" ||
    state === "unknown"
  );
}
