// Execution layer for the WOSM view's input. Keyboard input always flows
// through the shared transition machine (single behavioral source); this
// module is the semantic entry point mouse targets and chrome (footer hints)
// use to reach the same machine, plus the few Station mouse extensions that
// have no keyboard path in apps/tui (direct project-header collapse, wheel
// paging). Every mutation here lands via store.handleKey or a shared pure
// state function — no bespoke screen logic.
import type { StoreApi } from "zustand/vanilla";
import { selectDashboardViewport } from "@wosm/dashboard-core";
import { clampDashboardStateScroll, scrollDashboard } from "@wosm/dashboard-core";
import type { TuiKey } from "@wosm/dashboard-core";
import type { TuiHandleKeyResult, TuiStore } from "@wosm/dashboard-core";
import { sequenceToTuiKey } from "./sequenceToTuiKey.js";
import { matchWosmBinding, deriveWosmMode, type WosmBinding } from "./wosmKeymap.js";

export type WosmKeyOutcome =
  /** Dispatched into the machine; the overlay stays up. */
  | { kind: "handled" }
  /** The machine reported dismiss/exit intent; the router closes WOSM mode. */
  | { kind: "close-overlay" }
  /** No dashboard vocabulary for this sequence; swallowed, never dispatched. */
  | { kind: "unmapped" };

/**
 * The keyboard entry point the overlay keymap layer delegates to: translate
 * the normalized legacy sequence, dispatch through the machine, map the
 * transition meta to an outcome. Modal by construction — every sequence is
 * consumed whether or not it meant anything.
 */
export function handleWosmSequence(store: StoreApi<TuiStore>, sequence: string): WosmKeyOutcome {
  const key = sequenceToTuiKey(sequence);
  if (key === undefined) {
    return { kind: "unmapped" };
  }
  return outcomeForResult(store.getState().handleKey(key));
}

export function dispatchWosmKey(store: StoreApi<TuiStore>, key: TuiKey): WosmKeyOutcome {
  return outcomeForResult(store.getState().handleKey(key));
}

function outcomeForResult(result: TuiHandleKeyResult): WosmKeyOutcome {
  if (result.dismissPopup || result.exitCode !== undefined) {
    return { kind: "close-overlay" };
  }
  return { kind: "handled" };
}

/**
 * Synthesizes the representative key for a binding so clickable chrome
 * (footer hints, help rows) can dispatch exactly what pressing the key
 * would. Slot and text patterns have no single representative key.
 */
export function representativeKeyForBinding(binding: WosmBinding): TuiKey | undefined {
  const pattern = binding.pattern;
  switch (pattern.kind) {
    case "char":
      return pattern.ctrl === true ? { input: pattern.char, ctrl: true } : { input: pattern.char };
    case "named":
      switch (pattern.named) {
        case "return":
          return { input: "\r", return: true };
        case "escape":
          return { input: "", escape: true };
        case "backspace":
          return { input: "", backspace: true };
        case "delete":
          return { input: "", delete: true };
        case "up":
          return { input: "", upArrow: true };
        case "down":
          return { input: "", downArrow: true };
        case "left":
          return { input: "", leftArrow: true };
        case "right":
          return { input: "", rightArrow: true };
      }
      return undefined;
    case "slot":
    case "text":
      return undefined;
  }
}

/**
 * Dispatches a row interaction as the row's current slot key, so a click
 * means exactly what the slot accelerator means in the active mode
 * (dashboard: start-or-focus; remove/rename choose-slot: choose this row).
 * Rows without a slot (pending-operation rows) are inert.
 */
export function dispatchRowSlot(store: StoreApi<TuiStore>, rowId: string): WosmKeyOutcome {
  const state = store.getState();
  if (state.snapshot === undefined) {
    return { kind: "handled" };
  }
  const choice = selectDashboardViewport(state.snapshot, state).rowChoices.find(
    (candidate) => candidate.value.id === rowId,
  );
  if (choice === undefined) {
    return { kind: "handled" };
  }
  return dispatchWosmKey(store, { input: choice.key });
}

/**
 * Station mouse extension: direct project collapse toggle (apps/tui's
 * keyboard path goes through the C prompt; the visual notes specify
 * header-click toggle). Same state mutation the collapse screen performs.
 */
export function toggleProjectCollapsed(store: StoreApi<TuiStore>, projectId: string): void {
  const state = store.getState();
  const collapsedProjectIds = new Set(state.collapsedProjectIds);
  if (collapsedProjectIds.has(projectId)) {
    collapsedProjectIds.delete(projectId);
  } else {
    collapsedProjectIds.add(projectId);
  }
  store.setState(clampDashboardStateScroll({ ...state, collapsedProjectIds }));
}

/** Wheel/indicator scrolling via the shared scroll math. */
export function scrollWosmView(store: StoreApi<TuiStore>, delta: number): void {
  store.setState(scrollDashboard(store.getState(), delta));
}

export function dismissWosmToasts(store: StoreApi<TuiStore>): void {
  store.getState().dismissToasts();
}

/**
 * Dispatches a footer/help hint click as its binding's representative key,
 * but only when the binding belongs to the active mode (a stale hint from a
 * just-closed mode must not fire).
 */
export function dispatchBindingClick(
  store: StoreApi<TuiStore>,
  binding: WosmBinding,
): WosmKeyOutcome {
  const mode = deriveWosmMode(store.getState());
  const key = representativeKeyForBinding(binding);
  if (key === undefined) {
    return { kind: "handled" };
  }
  const active = matchWosmBinding(mode, key);
  if (active?.id !== binding.id) {
    return { kind: "handled" };
  }
  return dispatchWosmKey(store, key);
}
