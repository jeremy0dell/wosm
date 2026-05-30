import type { TerminalFocusOrigin, WosmSnapshot } from "@wosm/contracts";
import { useInput } from "ink";
import { useRef, useState } from "react";
import type { OverlayHostState } from "../components/OverlayHost/OverlayHost.js";
import type { NewSessionFlowState } from "../flows/newSession.js";
import { handleDashboardInput, overlayRenderState } from "../input/dashboardInput.js";
import type { DashboardInputKey } from "../input/types.js";
import type { PromptMode } from "../uiState/uiState.js";
import type { ObserverDashboardState } from "./useObserverDashboard.js";

export type UseDashboardInputOptions = {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot | undefined;
  exitOnFocusSuccess: boolean;
  focusOrigin: TerminalFocusOrigin | undefined;
  resolveFocusOrigin: (() => Promise<TerminalFocusOrigin | undefined>) | undefined;
  onFocusSuccess: (() => Promise<void>) | undefined;
  onDismiss: (() => Promise<void>) | undefined;
  persistentPopup: boolean;
  onExit: ((code: number) => void) | undefined;
};

export type DashboardInputState = {
  overlay: OverlayHostState | undefined;
};

export function useDashboardInput(options: UseDashboardInputOptions): DashboardInputState {
  const promptValueRef = useRef("");
  const promptModeRef = useRef<PromptMode | undefined>(undefined);
  const newSessionStateRef = useRef<NewSessionFlowState | undefined>(undefined);
  const [newSessionState, setRenderedNewSessionState] = useState<NewSessionFlowState | undefined>();
  const setNewSessionState = (next: NewSessionFlowState | undefined) => {
    newSessionStateRef.current = next;
    setRenderedNewSessionState(next);
  };

  useInput((input, key) => {
    handleDashboardInput({
      event: {
        input,
        key: dashboardInputKey(key),
      },
      dashboard: options.dashboard,
      snapshot: options.snapshot,
      promptValueRef,
      promptModeRef,
      newSessionState: newSessionStateRef.current,
      setNewSessionState,
      exitOnFocusSuccess: options.exitOnFocusSuccess,
      focusOrigin: options.focusOrigin,
      resolveFocusOrigin: options.resolveFocusOrigin,
      onFocusSuccess: options.onFocusSuccess,
      onDismiss: options.onDismiss,
      persistentPopup: options.persistentPopup,
      onExit: options.onExit,
    });
  });

  return {
    overlay: overlayRenderState(options.snapshot, options.dashboard.uiState, newSessionState),
  };
}

function dashboardInputKey(key: DashboardInputKey): DashboardInputKey {
  const inputKey: DashboardInputKey = {};
  if (key.ctrl === true) inputKey.ctrl = true;
  if (key.return === true) inputKey.return = true;
  if (key.escape === true) inputKey.escape = true;
  if (key.backspace === true) inputKey.backspace = true;
  if (key.delete === true) inputKey.delete = true;
  if (key.upArrow === true) inputKey.upArrow = true;
  if (key.downArrow === true) inputKey.downArrow = true;
  if (key.leftArrow === true) inputKey.leftArrow = true;
  if (key.rightArrow === true) inputKey.rightArrow = true;
  return inputKey;
}
