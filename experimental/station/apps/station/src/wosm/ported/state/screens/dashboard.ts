import type { TerminalFocusOrigin } from "@wosm/contracts";
import { createNewSessionFlow, createNewSessionNameToken } from "../../flows/newSession.js";
import { selectDashboardViewport } from "../../selectors/dashboardViewport.js";
import {
  choiceValueByKey,
  type KeyedChoice,
  selectProjectChoices,
} from "../../selectors/selectors.js";
import { safeErrorToToast } from "../../services/errors/errors.js";
import { buildFocusCommand, buildStartAgentCommand } from "../commandBuilders.js";
import { scrollDashboard } from "../dashboardScroll.js";
import type { TuiKey } from "../keys.js";
import { addPendingStartAgentRow } from "../localRows.js";
import { addTuiToast } from "../toasts.js";
import type { TuiKeyRuntimeContext, TuiTransition } from "../transition.js";
import type { TuiState } from "../types.js";
import { openAddProject } from "./addProjectScreen.js";

export function handleDashboardKey(
  state: TuiState,
  key: TuiKey,
  context: TuiKeyRuntimeContext,
): TuiTransition {
  const scrollDelta = scrollDeltaForKey(key);
  if (scrollDelta !== 0) {
    return {
      state: scrollDashboard(state, scrollDelta),
    };
  }

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
      state: {
        ...state,
        screen: { name: "renameSession", step: "chooseSlot" },
      },
    };
  }

  if (key.input === "Z") {
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

  if (key.input === "A") {
    return {
      state: openAddProject(state, context),
    };
  }

  if (key.input === "C") {
    return openProjectCollapse(state);
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

  if (row.agent === undefined) {
    return startAgentForRow(state, row);
  }

  return {
    state,
    commands: [buildFocusCommand(row, focusCommandOptions(state.runtime.focusOrigin))],
  };
}

export function scrollDeltaForKey(key: TuiKey): -1 | 0 | 1 {
  if (key.upArrow === true || key.mouseScroll === "up") {
    return -1;
  }
  if (key.downArrow === true || key.mouseScroll === "down") {
    return 1;
  }
  return 0;
}

function openNewSession(state: TuiState): TuiTransition {
  if (state.snapshot === undefined) {
    return { state };
  }

  const flow = createNewSessionFlow(state.snapshot, createNewSessionNameToken());
  if (flow === undefined) {
    return {
      state: addTuiToast(
        state,
        safeErrorToToast({
          tag: "CommandValidationError",
          code: "PROJECT_NOT_CONFIGURED",
          message: "No project is configured for a new session.",
          hint: "Add a project to config.toml and run wosm reconcile.",
        }),
      ),
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

function startAgentForRow(
  state: TuiState,
  row: NonNullable<TuiState["snapshot"]>["rows"][number],
): TuiTransition {
  const project = state.snapshot?.projects.find((candidate) => candidate.id === row.projectId);
  if (project === undefined) {
    return {
      state: addTuiToast(
        state,
        safeErrorToToast({
          tag: "CommandValidationError",
          code: "PROJECT_NOT_FOUND",
          message: `Project not found for worktree ${row.id}.`,
        }),
      ),
    };
  }

  const command = buildStartAgentCommand(row, project);
  const localId = `start:${row.id}`;

  return {
    state: addPendingStartAgentRow(state, {
      localId,
      projectId: row.projectId,
      worktreeId: row.id,
      branch: row.branch,
      createdAt: new Date().toISOString(),
    }),
    operations: [
      {
        type: "startAgent",
        localId,
        projectId: row.projectId,
        worktreeId: row.id,
        branch: row.branch,
        command,
      },
    ],
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
