import { selectProjectSlots } from "../../selectors/selectors.js";
import type { TuiKey } from "../keys.js";
import { isDigitSlotKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

export function handleProjectCollapseKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "projectCollapse") {
    return { state };
  }

  if (key.escape === true) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  if (state.snapshot === undefined || !isDigitSlotKey(key)) {
    return { state };
  }

  const project = selectProjectSlots(state.snapshot, state).get(key.input);
  if (project === undefined) {
    return { state };
  }

  const collapsedProjectIds = new Set(state.collapsedProjectIds);
  if (collapsedProjectIds.has(project.id)) {
    collapsedProjectIds.delete(project.id);
  } else {
    collapsedProjectIds.add(project.id);
  }

  return {
    state: {
      ...state,
      collapsedProjectIds,
      screen: { name: "dashboard" },
    },
  };
}
