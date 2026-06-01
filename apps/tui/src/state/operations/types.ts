import type { ProviderId, WosmCommand } from "@wosm/contracts";

export type CreateSessionOperation = {
  type: "createSession";
  localId: string;
  projectId: string;
  branch: string;
  harnessProvider: ProviderId;
  command: Extract<WosmCommand, { type: "session.create" }>;
};

export type TuiOperation = CreateSessionOperation;
