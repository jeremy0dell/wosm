import {
  kittySequenceToLegacy,
  pasteToStationTerminal,
  writeToStationTerminal,
} from "../terminal/index.js";
import { stripTerminalReplies } from "../terminal/input/terminalReplies.js";
import type { StoreApi } from "zustand/vanilla";
import type { StationStore } from "../state/store.js";
import { WOSM_OVERLAY_ID } from "../state/types.js";
import { sanitizePastedText } from "../wosm/input/sequenceToTuiKey.js";
import { dispatchWosmKey } from "../wosm/input/wosmActions.js";
import type { TuiStore } from "../wosm/ported/state/store.js";
import {
  routeKey,
  routeMouse,
  routePaste,
  type MouseBindings,
  type MouseTargetRef,
  type RouteOutcome,
  type StationCommandId,
  type StationMouseEvent,
} from "./router.js";
import type { KeymapStack } from "./keymaps.js";
import { createStationKeymap, createStationMouseBindings } from "./stationBindings.js";

export type NormalizedSequence = { consumed: true } | { consumed: false; legacy: string };

/**
 * Byte normalization runs before routing; the router never sees raw kitty
 * sequences or empty keys.
 *
 * Outer-terminal query replies that OpenTUI did not consume must never be
 * "typed" into the shell. Stripping them here means this prepended handler
 * intentionally runs before OpenTUI's own capability/pixel-resolution
 * handlers - preserved behavior, not an accident.
 */
export function normalizeSequence(raw: string): NormalizedSequence {
  const stripped = stripTerminalReplies(raw);
  if (stripped === "" && raw !== "") {
    return { consumed: true };
  }
  const legacy = kittySequenceToLegacy(stripped);
  if (legacy === "") {
    // Key releases and untranslatable functional keys: consumed, not leaked.
    return { consumed: true };
  }
  return { consumed: false, legacy };
}

export type StationInputEffects = {
  store: StationStore;
  runCommand(commandId: StationCommandId): void;
  writeToTerminal(bytes: string): boolean;
  pasteToTerminal(text: string): boolean;
};

/**
 * Applies a route outcome and reports whether the input was consumed.
 * Terminal delivery propagates the registry's result: with no live terminal
 * attached (process exited, pane unmounting) this returns false so OpenTUI's
 * own handlers still see the sequence.
 */
export function executeOutcome(outcome: RouteOutcome, effects: StationInputEffects): boolean {
  switch (outcome.kind) {
    case "command":
      effects.runCommand(outcome.commandId);
      return true;
    case "terminal-write":
      return effects.writeToTerminal(outcome.bytes);
    case "terminal-paste":
      return effects.pasteToTerminal(outcome.text);
    case "focus":
      // Only pane focus arrives as a bare focus outcome; overlay and dialog
      // focus changes are expressed as overlay/dialog outcomes and actions.
      if (outcome.target.kind === "pane") {
        effects.store.actions.focusPane(outcome.target.paneId);
      }
      return true;
    case "overlay-open":
      effects.store.actions.openOverlay(outcome.overlayId);
      return true;
    case "overlay-close":
      effects.store.actions.closeOverlay();
      return true;
    case "swallowed":
      return true;
    case "ignored":
      return false;
  }
}

export type StationPasteEvent = { bytes: Uint8Array; preventDefault(): void };

export type StationInputRuntime = {
  /** For prependInputHandlers; returns true when the sequence was consumed. */
  handleSequence(sequence: string): boolean;
  /** For renderer.keyInput.on("paste"); prevents default only on delivery. */
  handlePaste(event: StationPasteEvent): void;
  /** For renderable onMouseDown handlers; returns true when consumed. */
  dispatchMouse(target: MouseTargetRef, event: StationMouseEvent): boolean;
};

export type StationInputRuntimeOptions = {
  store: StationStore;
  shutdown(): void;
  /** Registers the WOSM dashboard layer + mouse targets when provided. */
  wosmViewStore?: StoreApi<TuiStore>;
  keymap?: KeymapStack<RouteOutcome>;
  mouseBindings?: MouseBindings;
  writeToTerminal?: (bytes: string) => boolean;
  pasteToTerminal?: (text: string) => boolean;
};

/**
 * The composition point: normalize -> route -> execute. Pure routing lives
 * in router.ts/keymaps.ts; registrations live in stationBindings.ts; this
 * wires them to the store, the terminal registry, and app commands.
 */
export function createStationInputRuntime(options: StationInputRuntimeOptions): StationInputRuntime {
  const keymap = options.keymap ?? createStationKeymap(options.wosmViewStore);
  const mouseBindings = options.mouseBindings ?? createStationMouseBindings(options.wosmViewStore);
  const commands: Record<StationCommandId, () => void> = {
    "station.exit": options.shutdown,
  };
  const effects: StationInputEffects = {
    store: options.store,
    runCommand: (commandId) => {
      commands[commandId]();
    },
    writeToTerminal: options.writeToTerminal ?? writeToStationTerminal,
    pasteToTerminal: options.pasteToTerminal ?? pasteToStationTerminal,
  };

  return {
    handleSequence: (sequence) => {
      const normalized = normalizeSequence(sequence);
      if (normalized.consumed) {
        return true;
      }
      return executeOutcome(routeKey(normalized.legacy, options.store.getState(), keymap), effects);
    },
    handlePaste: (event) => {
      const text = new TextDecoder().decode(event.bytes);
      // While WOSM mode is up, paste belongs to the dashboard's text-input
      // modes (search, name editors) — apps/tui receives pastes as plain
      // input chunks, and the ported machine treats them the same way. The
      // chunk is sanitized first (the key path's control-byte discipline
      // applies to this channel too), and a dismiss outcome — a one-char
      // paste can match a bound key — closes the overlay like a keypress.
      if (
        options.wosmViewStore !== undefined &&
        options.store.getState().input.activeOverlay === WOSM_OVERLAY_ID
      ) {
        event.preventDefault();
        const sanitized = sanitizePastedText(text);
        if (sanitized.length === 0) {
          return;
        }
        const outcome = dispatchWosmKey(options.wosmViewStore, { input: sanitized });
        if (outcome.kind === "close-overlay") {
          executeOutcome({ kind: "overlay-close", overlayId: WOSM_OVERLAY_ID }, effects);
        }
        return;
      }
      if (executeOutcome(routePaste(text, options.store.getState()), effects)) {
        event.preventDefault();
      }
    },
    dispatchMouse: (target, event) => {
      return executeOutcome(routeMouse(target, event, options.store.getState(), mouseBindings), effects);
    },
  };
}
