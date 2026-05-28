import type { WosmSnapshot } from "@wosm/contracts";
import type { OverlayHostState } from "../components/OverlayHost/OverlayHost.js";
import type { NewSessionFlowState } from "../flows/newSession.js";
import type { TuiUiState } from "../uiState.js";
import { dashboardInputModes } from "./dashboardModeRegistry.js";
import type { DashboardInputContext } from "./types.js";

export function handleDashboardInput(context: DashboardInputContext): void {
  if (context.event.key.ctrl === true && context.event.input === "c") {
    context.onExit?.(0);
    return;
  }

  for (const mode of dashboardInputModes) {
    if (mode.canHandle(context)) {
      mode.handle(context);
      return;
    }
  }
}

export function overlayRenderState(
  snapshot: WosmSnapshot | undefined,
  uiState: TuiUiState,
  newSessionState: NewSessionFlowState | undefined,
): OverlayHostState | undefined {
  if (uiState.activeOverlay === "help") {
    return { type: "help" };
  }
  if (snapshot !== undefined && newSessionState !== undefined) {
    return {
      type: "new-session",
      snapshot,
      state: newSessionState,
    };
  }
  return undefined;
}
