import { kittySequenceToLegacy, pasteToStationTerminal, writeToStationTerminal } from "./terminal/index.js";
import { stripTerminalReplies } from "./terminal/input/terminalReplies.js";

export type StationAppInputDeps = {
  isOverlayVisible(): boolean;
  toggleOverlay(): void;
  shutdown(): void;
};

const STATION_EXIT_LEGACY = "\x11"; // Ctrl-Q
const OVERLAY_TOGGLE_LEGACY = "\x0f"; // Ctrl-O

/**
 * The app-level key sequence handler: Station chords first, overlay swallow,
 * then pane passthrough. Sequences are translated to legacy bytes before
 * matching, so kitty CSI-u variants (including alternate-key forms) hit the
 * chords instead of leaking into the shell, and pane children always receive
 * the bytes a legacy terminal would send.
 */
export function createStationSequenceHandler(
  deps: StationAppInputDeps,
): (sequence: string) => boolean {
  return (rawSequence) => {
    // Outer-terminal query replies that OpenTUI did not consume must never
    // be "typed" into the shell.
    const sequence = stripTerminalReplies(rawSequence);
    if (sequence === "" && rawSequence !== "") {
      return true;
    }
    const legacy = kittySequenceToLegacy(sequence);
    if (legacy === STATION_EXIT_LEGACY) {
      deps.shutdown();
      return true;
    }
    if (legacy === OVERLAY_TOGGLE_LEGACY) {
      deps.toggleOverlay();
      return true;
    }
    if (deps.isOverlayVisible()) {
      // WOSM mode is read-only: swallow input so keystrokes cannot reach
      // the hidden shell pane.
      return true;
    }
    if (legacy === "") {
      // Key releases and untranslatable functional keys: consumed, not leaked.
      return true;
    }
    return writeToStationTerminal(legacy);
  };
}

/** Returns true when the paste was delivered to the pane. */
export function forwardStationPaste(
  bytes: Uint8Array,
  deps: Pick<StationAppInputDeps, "isOverlayVisible">,
): boolean {
  if (deps.isOverlayVisible()) {
    return false;
  }
  return pasteToStationTerminal(new TextDecoder().decode(bytes));
}
