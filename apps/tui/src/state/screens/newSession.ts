import {
  createNewSessionNameToken,
  newSessionIntentForInput,
  transitionNewSessionFlow,
  validateNewSessionCreate,
} from "../../flows/newSession.js";
import { safeErrorToToast } from "../../services/errors/errors.js";
import { buildCreateSessionCommand } from "../commandBuilders.js";
import type { TuiKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

export function handleNewSessionKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "newSession") {
    return { state };
  }

  if (state.snapshot === undefined) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  const intent = newSessionIntentForInput(state.screen.flow, {
    input: key.input,
    key,
    token: createNewSessionNameToken(),
  });

  if (intent.type === "none") {
    return { state };
  }

  if (intent.type === "submit") {
    return submitNewSession(state);
  }

  const flow = transitionNewSessionFlow(state.screen.flow, state.snapshot, intent.action);
  if (flow === undefined) {
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
      screen: { name: "newSession", flow },
    },
  };
}

function submitNewSession(state: TuiState): TuiTransition {
  if (state.screen.name !== "newSession" || state.snapshot === undefined) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }

  const validation = validateNewSessionCreate(state.snapshot, state.screen.flow);
  if (!validation.ok) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
        toasts: [...state.toasts, safeErrorToToast(validation.error)],
      },
    };
  }

  return {
    state: {
      ...state,
      screen: { name: "dashboard" },
    },
    commands: [
      buildCreateSessionCommand({
        project: validation.project,
        branch: validation.branch.trim(),
        harnessProvider: validation.harnessProvider,
      }),
    ],
  };
}
