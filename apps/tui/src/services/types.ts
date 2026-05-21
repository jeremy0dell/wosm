import type { CommandReceipt, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";

export type TuiObserverService = {
  loadSnapshot(): Promise<WosmSnapshot>;
  subscribeEvents(): AsyncIterable<WosmEvent>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  reconcile(reason?: string): Promise<WosmSnapshot>;
};

export type TuiToast = {
  kind: "info" | "success" | "error";
  message: string;
  hint?: string;
  commandId?: string;
  traceId?: string;
  diagnosticId?: string;
};

export type TuiRunResult = {
  status: "exited";
  code: number;
};
