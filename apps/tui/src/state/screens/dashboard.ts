import type { TerminalFocusOrigin } from "@wosm/contracts";
import { createNewSessionFlow, createNewSessionNameToken } from "../../flows/newSession.js";
import {
  choiceValueByKey,
  type KeyedChoice,
  selectDashboardRowChoices,
  selectProjectChoices,
} from "../../selectors/selectors.js";
import { safeErrorToToast } from "../../services/errors/errors.js";
import { buildPrimaryCommandForRow } from "../commandBuilders.js";
import type { TuiKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

export function handleDashboardKey(state: TuiState, key: TuiKey): TuiTransition {
  if (key.input === "H" || key.input === "?") {
    return {
      state: {
        ...state,
        screen: { name: "help" },
      },
    };
  }

  if (
    state.runtime.persistentPopup &&
    state.runtime.canDismissPopup &&
    (key.input === "Q" || key.escape === true)
  ) {
    return {
      state,
      dismissPopup: true,
    };
  }

  if (key.input === "Q") {
    return {
      state,
      exitCode: 0,
    };
  }

  if (key.input === "/") {
    return {
      state: {
        ...state,
        screen: { name: "search", value: "" },
      },
    };
  }

  if (key.input === "R") {
    return {
      state,
      reconcileReason: "tui-refresh",
    };
  }

  if (key.input === "X") {
    return {
      state: {
        ...state,
        screen: { name: "removeWorktree", step: "chooseSlot" },
      },
    };
  }

  if (key.input === "N") {
    return openNewSession(state);
  }

  if (key.input === "C") {
    return openProjectCollapse(state);
  }

  if (state.snapshot === undefined) {
    return { state };
  }

  const row = choiceValueByKey(selectDashboardRowChoices(state.snapshot, state), key.input);
  if (row === undefined) {
    return { state };
  }

  return {
    state,
    commands: [
      buildPrimaryCommandForRow(
        row,
        state.snapshot,
        focusCommandOptions(state.runtime.focusOrigin),
      ),
    ],
  };
}

function openNewSession(state: TuiState): TuiTransition {
  if (state.snapshot === undefined) {
    return { state };
  }

  const flow = createNewSessionFlow(state.snapshot, createNewSessionNameToken());
  if (flow === undefined) {
    return {
      state: {
        ...state,
        toasts: [
          ...state.toasts,
          safeErrorToToast({
            tag: "CommandValidationError",
            code: "PROJECT_NOT_CONFIGURED",
            message: "No project is configured for a new session.",
            hint: "Add a project to config.toml and run wosm reconcile.",
          }),
        ],
      },
    };
  }

  return {
    state: {
      ...state,
      screen: { name: "newSession", flow },
    },
  };
}

function openProjectCollapse(state: TuiState): TuiTransition {
  if (state.snapshot === undefined) {
    return { state };
  }
  return {
    state: {
      ...state,
      screen: {
        name: "projectCollapse",
        value: formatProjectChoicePrompt(selectProjectChoices(state.snapshot, state)),
      },
    },
  };
}

function formatProjectChoicePrompt(choices: ReadonlyArray<KeyedChoice<{ label: string }>>): string {
  return choices.map((choice) => `${choice.key}:${choice.value.label}`).join(" ");
}

function focusCommandOptions(focusOrigin: TerminalFocusOrigin | undefined): {
  origin?: TerminalFocusOrigin;
} {
  const options: { origin?: TerminalFocusOrigin } = {};
  if (focusOrigin !== undefined) {
    options.origin = focusOrigin;
  }
  return options;
}
