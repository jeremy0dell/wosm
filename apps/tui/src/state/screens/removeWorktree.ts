import { selectDashboardViewport } from "../../selectors/dashboardViewport.js";
import { choiceValueByKey } from "../../selectors/selectors.js";
import { buildRemoveWorktreeCommand, cleanupForceRequired } from "../commandBuilders.js";
import { scrollDashboard } from "../dashboardScroll.js";
import type { TuiKey } from "../keys.js";
import { isReturnKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";
import { scrollDeltaForKey } from "./dashboard.js";

export function handleRemoveWorktreeKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "removeWorktree") {
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

  if (state.screen.step === "chooseSlot") {
    return handleChooseSlotKey(state, key);
  }

  return handleConfirmKey(state, key);
}

function handleChooseSlotKey(state: TuiState, key: TuiKey): TuiTransition {
  const scrollDelta = scrollDeltaForKey(key);
  if (scrollDelta !== 0) {
    return {
      state: scrollDashboard(state, scrollDelta),
    };
  }

  if (state.snapshot === undefined) {
    return { state };
  }

  const row = choiceValueByKey(
    selectDashboardViewport(state.snapshot, state).rowChoices,
    key.input,
  );
  if (row === undefined) {
    return { state };
  }

  return {
    state: {
      ...state,
      screen: {
        name: "removeWorktree",
        step: "confirm",
        rowId: row.id,
        forceRequired: cleanupForceRequired(row, "remove-worktree"),
        label: `remove ${row.branch}? Y/N`,
      },
    },
  };
}

function handleConfirmKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "removeWorktree" || state.screen.step !== "confirm") {
    return { state };
  }

  const input = key.input.toLowerCase();

  if (input === "n" || key.escape === true || isReturnKey(key)) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  if (input !== "y") {
    return { state };
  }

  const screen = state.screen;
  const row = state.snapshot?.rows.find((candidate) => candidate.id === screen.rowId);
  if (row === undefined) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  return {
    state: {
      ...state,
      screen: { name: "dashboard" },
    },
    commands: [buildRemoveWorktreeCommand(row, screen.forceRequired)],
  };
}
