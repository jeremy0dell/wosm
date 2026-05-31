import { choiceValueByKey, selectDashboardRowChoices } from "../../selectors/selectors.js";
import { buildRemoveWorktreeCommand, cleanupForceRequired } from "../commandBuilders.js";
import type { TuiKey } from "../keys.js";
import { isReturnKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

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
  if (state.snapshot === undefined) {
    return { state };
  }

  const row = choiceValueByKey(selectDashboardRowChoices(state.snapshot, state), key.input);
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

  if (key.input === "N" || key.escape === true || isReturnKey(key)) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  if (key.input !== "Y") {
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
