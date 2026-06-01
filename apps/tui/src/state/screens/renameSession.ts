import type { SessionView, WorktreeRow, WosmSnapshot } from "@wosm/contracts";
import {
  createEditableTextInputState,
  editableTextInputIntentForInput,
  transitionEditableTextInput,
} from "../../components/EditableTextInput/editing.js";
import { selectDashboardViewport } from "../../selectors/dashboardViewport.js";
import { choiceValueByKey, worktreeRowDisplayTitle } from "../../selectors/selectors.js";
import { safeErrorToToast } from "../../services/errors/errors.js";
import { buildRenameSessionCommand } from "../commandBuilders.js";
import { scrollDashboard } from "../dashboardScroll.js";
import type { TuiKey } from "../keys.js";
import { isReturnKey } from "../keys.js";
import { addPendingRenameSessionTitle } from "../localRows.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";
import { scrollDeltaForKey } from "./dashboard.js";

export function handleRenameSessionKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "renameSession") {
    return { state };
  }

  if (state.screen.step === "chooseSlot") {
    return handleChooseSlotKey(state, key);
  }

  return handleEditNameKey(state, key);
}

function handleChooseSlotKey(state: TuiState, key: TuiKey): TuiTransition {
  if (key.escape === true) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

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

  const session = sessionForRow(state.snapshot, row);
  if (session === undefined) {
    return {
      state: {
        ...state,
        toasts: [
          ...state.toasts,
          safeErrorToToast({
            tag: "CommandValidationError",
            code: "SESSION_NOT_FOUND",
            message: "No session exists for that row.",
          }),
        ],
      },
    };
  }

  const currentTitle = worktreeRowDisplayTitle(row, state.snapshot.sessions, state.localRows);
  return {
    state: {
      ...state,
      screen: {
        name: "renameSession",
        step: "editName",
        rowId: row.id,
        sessionId: session.id,
        currentTitle,
        draftTitle: createEditableTextInputState(currentTitle),
      },
    },
  };
}

function handleEditNameKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "renameSession" || state.screen.step !== "editName") {
    return { state };
  }

  if (key.escape === true) {
    return {
      state: {
        ...state,
        screen: { name: "renameSession", step: "chooseSlot" },
      },
    };
  }

  if (isReturnKey(key)) {
    return submitRename(state);
  }

  const intent = editableTextInputIntentForInput({ input: key.input, key });
  if (intent.type !== "edit") {
    return { state };
  }

  return {
    state: {
      ...state,
      screen: {
        ...state.screen,
        draftTitle: transitionEditableTextInput(state.screen.draftTitle, intent.action),
      },
    },
  };
}

function submitRename(state: TuiState): TuiTransition {
  if (state.screen.name !== "renameSession" || state.screen.step !== "editName") {
    return { state };
  }

  const title = state.screen.draftTitle.value.trim();
  if (title.length === 0) {
    return {
      state: {
        ...state,
        toasts: [
          ...state.toasts,
          safeErrorToToast({
            tag: "CommandValidationError",
            code: "SESSION_TITLE_EMPTY",
            message: "Session title cannot be empty.",
          }),
        ],
      },
    };
  }

  if (title === state.screen.currentTitle.trim()) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  const command = buildRenameSessionCommand({
    sessionId: state.screen.sessionId,
    title,
  });
  if (command.type !== "session.rename") {
    return { state };
  }

  return {
    state: addPendingRenameSessionTitle(
      {
        ...state,
        screen: { name: "dashboard" },
      },
      {
        sessionId: state.screen.sessionId,
        title,
        createdAt: new Date().toISOString(),
      },
    ),
    operations: [
      {
        type: "renameSession",
        sessionId: state.screen.sessionId,
        title,
        command,
      },
    ],
  };
}

function sessionForRow(snapshot: WosmSnapshot, row: WorktreeRow): SessionView | undefined {
  const sessionId = row.agent?.sessionId;
  if (sessionId !== undefined) {
    const direct = snapshot.sessions.find((session) => session.id === sessionId);
    if (direct !== undefined) {
      return direct;
    }
  }
  return snapshot.sessions.find((session) => session.worktreeId === row.id);
}
