export type {
  ClientNotice as TuiToast,
  ObserverService as TuiObserverService,
  WosmClientCommandCompletion as TuiCommandCompletion,
} from "@wosm/client";

export type TuiRunResult = {
  status: "exited";
  code: number;
};
