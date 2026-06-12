// The WOSM view's mouse routing: one pure resolver in the spike plan's
// routeMouse(target, event, state) shape. Renderables attach wosmMouseProps
// and never decide behavior; every interaction resolves here against the
// active mode, dispatching the same semantic entry points keyboard uses.
// Hover is deliberately absent — it is component-local presentation state
// and never touches a store.
import type { StoreApi } from "zustand/vanilla";
import type { TuiStore } from "@wosm/dashboard-core";
import {
  dismissWosmToasts,
  dispatchBindingClick,
  dispatchRowSlot,
  dispatchWosmKey,
  scrollWosmView,
  toggleProjectCollapsed,
  type WosmKeyOutcome,
} from "./wosmActions.js";
import { deriveWosmMode, WOSM_KEYMAP, type WosmInputMode } from "./wosmKeymap.js";

export type WosmMouseTarget =
  | { kind: "row"; rowId: string }
  | { kind: "projectHeader"; projectId: string }
  | { kind: "body" }
  | { kind: "scrollIndicator"; direction: "up" | "down" }
  | { kind: "footerHint"; bindingId: string }
  | { kind: "toast" }
  /** A picker line inside a sheet; the key is the line's slot accelerator. */
  | { kind: "sheetChoice"; choiceKey: string }
  /** Sheets/prompts sit above the dashboard; their backdrop absorbs input. */
  | { kind: "sheetBackdrop" };

export type WosmMouseEventKind = "down" | "scroll-up" | "scroll-down";

export type WosmMouseOutcome =
  /** Consumed; effect (if any) already dispatched into the view store. */
  | { kind: "handled" }
  /** Consumed; the router should close WOSM mode. */
  | { kind: "close-overlay" };

const SCROLL_PAGE_ROWS = 5;

/** Modes whose tables give row slots and scrolling a meaning. */
const ROW_INTERACTIVE_MODES: ReadonlySet<WosmInputMode> = new Set([
  "dashboard",
  "removeChooseSlot",
  "renameChooseSlot",
]);

export function routeWosmMouse(
  target: WosmMouseTarget,
  eventKind: WosmMouseEventKind,
  store: StoreApi<TuiStore>,
): WosmMouseOutcome {
  const mode = deriveWosmMode(store.getState());

  if (eventKind !== "down") {
    return routeWosmWheel(target, eventKind, store, mode);
  }

  switch (target.kind) {
    case "row":
      if (!ROW_INTERACTIVE_MODES.has(mode)) {
        return { kind: "handled" };
      }
      return fromKeyOutcome(dispatchRowSlot(store, target.rowId));
    case "projectHeader":
      if (mode !== "dashboard") {
        return { kind: "handled" };
      }
      toggleProjectCollapsed(store, target.projectId);
      return { kind: "handled" };
    case "scrollIndicator":
      if (!ROW_INTERACTIVE_MODES.has(mode)) {
        return { kind: "handled" };
      }
      scrollWosmView(store, target.direction === "up" ? -SCROLL_PAGE_ROWS : SCROLL_PAGE_ROWS);
      return { kind: "handled" };
    case "footerHint": {
      const binding = bindingById(mode, target.bindingId);
      if (binding === undefined) {
        return { kind: "handled" };
      }
      return fromKeyOutcome(dispatchBindingClick(store, binding));
    }
    case "toast":
      dismissWosmToasts(store);
      return { kind: "handled" };
    case "sheetChoice":
      if (!SHEET_CHOICE_MODES.has(mode)) {
        return { kind: "handled" };
      }
      return fromKeyOutcome(dispatchWosmKey(store, { input: target.choiceKey }));
    case "body":
    case "sheetBackdrop":
      return { kind: "handled" };
  }
}

/** Modes whose sheets list slot-keyed choices a click can select. */
const SHEET_CHOICE_MODES: ReadonlySet<WosmInputMode> = new Set([
  "newSessionPickProject",
  "newSessionPickAgent",
]);

function routeWosmWheel(
  target: WosmMouseTarget,
  eventKind: "scroll-up" | "scroll-down",
  store: StoreApi<TuiStore>,
  mode: WosmInputMode,
): WosmMouseOutcome {
  // Sheets and prompts must not scroll the dashboard beneath them.
  if (target.kind === "sheetBackdrop" || !ROW_INTERACTIVE_MODES.has(mode)) {
    return { kind: "handled" };
  }
  scrollWosmView(store, eventKind === "scroll-up" ? -1 : 1);
  return { kind: "handled" };
}

function bindingById(mode: WosmInputMode, bindingId: string) {
  return WOSM_KEYMAP[mode].find((binding) => binding.id === bindingId);
}

function fromKeyOutcome(outcome: WosmKeyOutcome): WosmMouseOutcome {
  return outcome.kind === "close-overlay" ? { kind: "close-overlay" } : { kind: "handled" };
}
