import { closeOverlay } from "../uiState/uiState.js";
import { handleDashboardKeyInput } from "./dashboardKeyInput.js";
import { handleNewSessionInput } from "./newSessionInput.js";
import { handlePromptInput } from "./promptInput.js";
import type { DashboardInputContext, DashboardInputMode } from "./types.js";

export const dashboardInputModes: readonly DashboardInputMode[] = [
  {
    name: "new-session",
    canHandle: (context) => context.newSessionState !== undefined,
    handle: handleNewSessionInput,
  },
  {
    name: "prompt",
    canHandle: (context) =>
      context.dashboard.uiState.prompt !== undefined || context.promptModeRef.current !== undefined,
    handle: handlePromptInput,
  },
  {
    name: "help-overlay",
    canHandle: (context) => context.dashboard.uiState.activeOverlay === "help",
    handle: handleHelpOverlayInput,
  },
  {
    name: "dashboard",
    canHandle: () => true,
    handle: handleDashboardKeyInput,
  },
];

function handleHelpOverlayInput(context: DashboardInputContext): void {
  if (
    context.event.input === "H" ||
    context.event.input === "?" ||
    context.event.input === "Q" ||
    context.event.key.escape === true
  ) {
    context.dashboard.setUiState((current) => closeOverlay(current));
  }
}
