import type { ProviderId, SessionId, WorktreeId, WosmCommand } from "@wosm/contracts";

export type CreateSessionOperation = {
  type: "createSession";
  localId: string;
  projectId: string;
  branch: string;
  harnessProvider: ProviderId;
  command: Extract<WosmCommand, { type: "session.create" }>;
};

export type RemoveWorktreeOperation = {
  type: "removeWorktree";
  localId: string;
  projectId: string;
  worktreeId: WorktreeId;
  branch: string;
  command: Extract<WosmCommand, { type: "worktree.remove" }>;
};

export type StartAgentOperation = {
  type: "startAgent";
  localId: string;
  projectId: string;
  worktreeId: WorktreeId;
  branch: string;
  command: Extract<WosmCommand, { type: "session.startAgent" }>;
};

export type ResumeAgentOperation = {
  type: "resumeAgent";
  localId: string;
  projectId: string;
  worktreeId: WorktreeId;
  branch: string;
  command: Extract<WosmCommand, { type: "session.resumeAgent" }>;
};

export type RenameSessionOperation = {
  type: "renameSession";
  sessionId: SessionId;
  title: string;
  command: Extract<WosmCommand, { type: "session.rename" }>;
};

export type LoadProjectDirectoryOperation = {
  type: "loadProjectDirectory";
  path: string;
};

export type ReviewProjectFolderOperation = {
  type: "reviewProjectFolder";
  path: string;
};

export type SearchProjectDirectoriesOperation = {
  type: "searchProjectDirectories";
  query: string;
};

export type AddProjectOperation = {
  type: "addProject";
  command: Extract<WosmCommand, { type: "project.add" }>;
};

export type TuiOperation =
  | CreateSessionOperation
  | RemoveWorktreeOperation
  | StartAgentOperation
  | ResumeAgentOperation
  | RenameSessionOperation
  | LoadProjectDirectoryOperation
  | ReviewProjectFolderOperation
  | SearchProjectDirectoriesOperation
  | AddProjectOperation;
