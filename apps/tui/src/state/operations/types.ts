import type { ProviderId, WorktreeId, WosmCommand } from "@wosm/contracts";

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

export type TuiOperation = CreateSessionOperation | RemoveWorktreeOperation;
