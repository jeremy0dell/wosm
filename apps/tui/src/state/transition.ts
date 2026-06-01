import type { WosmCommand } from "@wosm/contracts";
import type { TuiKey } from "./keys.js";
import type { TuiOperation } from "./operations/types.js";
import type { TuiState } from "./screen.js";
import { handleDashboardKey } from "./screens/dashboard.js";
import { handleHelpKey } from "./screens/help.js";
import { handleNewSessionKey } from "./screens/newSession.js";
import { handleProjectCollapseKey } from "./screens/projectCollapse.js";
import { handleRemoveWorktreeKey } from "./screens/removeWorktree.js";
import { handleRenameSessionKey } from "./screens/renameSession.js";
import { handleSearchKey } from "./screens/search.js";

export type TuiTransition = {
  state: TuiState;
  commands?: WosmCommand[];
  operations?: TuiOperation[];
  reconcileReason?: string;
  exitCode?: number;
  dismissPopup?: true;
};

export function handleTuiKey(state: TuiState, key: TuiKey): TuiTransition {
  if (key.ctrl === true && key.input === "c") {
    return {
      state,
      exitCode: 0,
    };
  }

  switch (state.screen.name) {
    case "dashboard":
      return handleDashboardKey(state, key);
    case "help":
      return handleHelpKey(state, key);
    case "search":
      return handleSearchKey(state, key);
    case "projectCollapse":
      return handleProjectCollapseKey(state, key);
    case "removeWorktree":
      return handleRemoveWorktreeKey(state, key);
    case "renameSession":
      return handleRenameSessionKey(state, key);
    case "newSession":
      return handleNewSessionKey(state, key);
  }
}
