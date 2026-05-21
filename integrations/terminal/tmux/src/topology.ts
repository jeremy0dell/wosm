import type { TmuxConfig } from "@wosm/config";

export type TmuxWorkbenchConfig = {
  topology: "workbench";
  workbenchSession: string;
  windowNaming: "project-branch";
  primaryAgentPane: boolean;
  popupWidth: string;
  popupHeight: string;
  popupPosition: string;
};

export const defaultTmuxWorkbenchConfig: TmuxWorkbenchConfig = {
  topology: "workbench",
  workbenchSession: "wosm",
  windowNaming: "project-branch",
  primaryAgentPane: true,
  popupWidth: "95%",
  popupHeight: "85%",
  popupPosition: "C",
};

export function resolveTmuxWorkbenchConfig(config: TmuxConfig = {}): TmuxWorkbenchConfig {
  return {
    topology: config.topology ?? defaultTmuxWorkbenchConfig.topology,
    workbenchSession: config.workbenchSession ?? defaultTmuxWorkbenchConfig.workbenchSession,
    windowNaming: config.windowNaming ?? defaultTmuxWorkbenchConfig.windowNaming,
    primaryAgentPane: config.primaryAgentPane ?? defaultTmuxWorkbenchConfig.primaryAgentPane,
    popupWidth: config.popupWidth ?? defaultTmuxWorkbenchConfig.popupWidth,
    popupHeight: config.popupHeight ?? defaultTmuxWorkbenchConfig.popupHeight,
    popupPosition: config.popupPosition ?? defaultTmuxWorkbenchConfig.popupPosition,
  };
}

export function buildWorkbenchWindowName(input: { projectId: string; branch: string }): string {
  const normalized = `${input.projectId}-${input.branch}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const safe = normalized.length > 0 ? normalized : "worktree";
  return safe.slice(0, 48).replace(/-+$/g, "") || "worktree";
}

export function buildTmuxTargetId(input: {
  sessionId: string;
  windowId: string;
  paneId: string;
}): string {
  return `tmux:${input.sessionId}:${input.windowId}:${input.paneId}`;
}

export function parseTmuxTargetId(targetId: string): {
  sessionId: string;
  windowId: string;
  paneId: string;
} {
  const [provider, sessionId, windowId, paneId, ...extra] = targetId.split(":");
  if (
    provider !== "tmux" ||
    sessionId === undefined ||
    windowId === undefined ||
    paneId === undefined
  ) {
    throw new Error(`Invalid tmux target id: ${targetId}`);
  }
  if (extra.length > 0) {
    throw new Error(`Invalid tmux target id: ${targetId}`);
  }
  return { sessionId, windowId, paneId };
}

export function tmuxWindowTarget(input: { sessionId: string; windowNameOrId: string }): string {
  return `${input.sessionId}:${input.windowNameOrId}`;
}

export function tmuxPrimaryPaneTarget(input: {
  sessionId: string;
  windowNameOrId: string;
}): string {
  return `${input.sessionId}:${input.windowNameOrId}.0`;
}
