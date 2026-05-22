import type { TerminalTargetObservation } from "@wosm/contracts";
import { buildTmuxTargetId } from "./topology.js";

export const tmuxListTargetsFormat = [
  "#{session_name}",
  "#{window_id}",
  "#{pane_id}",
  "#{session_attached}",
  "#{pane_current_path}",
  "#{pane_pid}",
  "#{pane_current_command}",
  "#{window_name}",
  "#{@wosm.session_id}",
  "#{@wosm.project_id}",
  "#{@wosm.worktree_id}",
  "#{@wosm.role}",
  "#{@wosm.harness}",
].join("\t");

export function parseTmuxTargetLines(
  stdout: string,
  options: {
    observedAt: string;
  },
): TerminalTargetObservation[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }

  return trimmed.split(/\r?\n/).map((line) => parseTmuxTargetLine(line, options));
}

function parseTmuxTargetLine(
  line: string,
  options: {
    observedAt: string;
  },
): TerminalTargetObservation {
  const [
    sessionId = "",
    windowId = "",
    paneId = "",
    attached = "0",
    cwd = "",
    pid = "",
    currentCommand = "",
    title = "",
    wosmSessionId = "",
    projectId = "",
    worktreeId = "",
    role = "",
    harness = "",
  ] = line.split("\t");
  const hasBinding = projectId.length > 0 && worktreeId.length > 0 && role === "main-agent";
  const parsedPid = parsePositiveInteger(pid);
  const providerData: Record<string, unknown> = {
    sessionId,
    windowId,
    paneId,
    role,
    harness,
    attached: attached === "1",
  };
  if (currentCommand.length > 0) {
    providerData.currentCommand = currentCommand;
  }

  return {
    id: buildTmuxTargetId({ sessionId, windowId, paneId }),
    provider: "tmux",
    ...(projectId.length === 0 ? {} : { projectId }),
    ...(worktreeId.length === 0 ? {} : { worktreeId }),
    ...(wosmSessionId.length === 0 ? {} : { sessionId: wosmSessionId }),
    state: attached === "1" ? "open" : "detached",
    ...(cwd.length === 0 ? {} : { cwd }),
    ...(parsedPid === undefined ? {} : { pid: parsedPid }),
    ...(title.length === 0 ? {} : { title }),
    confidence: hasBinding ? "high" : "low",
    reason: hasBinding
      ? "tmux pane has wosm identity binding."
      : "tmux pane is missing wosm identity binding.",
    observedAt: options.observedAt,
    providerData,
  };
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
