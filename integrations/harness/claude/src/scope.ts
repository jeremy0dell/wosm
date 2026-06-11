export type ClaudeHookScopeContext = {
  cwd?: string;
  wosmProjectId?: string;
  wosmWorktreeId?: string;
  wosmWorktreePath?: string;
  wosmSessionId?: string;
  wosmTerminalProvider?: string;
  wosmTerminalTargetId?: string;
};

function assignStringField(
  target: ClaudeHookScopeContext,
  key: keyof ClaudeHookScopeContext,
  value: unknown,
) {
  if (typeof value !== "string" || value.length === 0) {
    return;
  }
  target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractClaudeHookScopeContext(payload: unknown): ClaudeHookScopeContext {
  const context: ClaudeHookScopeContext = {};
  if (!isRecord(payload)) {
    return context;
  }

  assignStringField(context, "cwd", payload.cwd);
  assignStringField(context, "wosmProjectId", payload.wosm_project_id);
  assignStringField(context, "wosmWorktreeId", payload.wosm_worktree_id);
  assignStringField(context, "wosmWorktreePath", payload.wosm_worktree_path);
  assignStringField(context, "wosmSessionId", payload.wosm_session_id);
  assignStringField(context, "wosmTerminalProvider", payload.wosm_terminal_provider);
  assignStringField(context, "wosmTerminalTargetId", payload.wosm_terminal_target_id);
  return context;
}
