import type { TuiKey } from "../keys.js";
import type { TuiState } from "../screen.js";
import type { TuiTransition } from "../transition.js";

export function handleHelpKey(state: TuiState, key: TuiKey): TuiTransition {
  if (key.input === "H" || key.input === "?" || key.input === "Q" || key.escape === true) {
    return {
      state: {
        ...state,
        screen: { name: "dashboard" },
      },
    };
  }
  return { state };
}
