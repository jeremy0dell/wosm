import type { TuiKey } from "../keys.js";
import { isReturnKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

export function handleSearchKey(state: TuiState, key: TuiKey): TuiTransition {
  if (state.screen.name !== "search") {
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

  if (key.backspace === true || key.delete === true) {
    return {
      state: {
        ...state,
        screen: {
          name: "search",
          value: state.screen.value.slice(0, -1),
        },
      },
    };
  }

  if (isReturnKey(key)) {
    return {
      state: {
        ...state,
        searchQuery: state.screen.value,
        screen: { name: "dashboard" },
      },
    };
  }

  if (key.input.length === 0) {
    return { state };
  }

  return {
    state: {
      ...state,
      screen: {
        name: "search",
        value: `${state.screen.value}${key.input}`,
      },
    },
  };
}
