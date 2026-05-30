import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import type { NewSessionFlowState } from "../flows/newSession.js";
import type { ObserverDashboardState } from "../hooks/useObserverDashboard.js";
import type { PromptMode } from "../uiState/uiState.js";

export type DashboardInputKey = {
  ctrl?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

export type DashboardInputEvent = {
  input: string;
  key: DashboardInputKey;
};

export type DashboardInputRef<T> = {
  current: T;
};

export type DashboardInputContext = {
  event: DashboardInputEvent;
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot | undefined;
  promptValueRef: DashboardInputRef<string>;
  promptModeRef: DashboardInputRef<PromptMode | undefined>;
  newSessionState: NewSessionFlowState | undefined;
  setNewSessionState(next: NewSessionFlowState | undefined): void;
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  onDismiss: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
};

export type DashboardInputMode = {
  name: string;
  canHandle(context: DashboardInputContext): boolean;
  handle(context: DashboardInputContext): void;
};
