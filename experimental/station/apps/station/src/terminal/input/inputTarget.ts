import type { StationTerminalProcess } from "../types.js";

let activeTerminal: StationTerminalProcess | null = null;

export function setStationTerminalInputTarget(terminal: StationTerminalProcess | null): void {
  activeTerminal = terminal;
}

export function writeToStationTerminal(sequence: string): boolean {
  if (activeTerminal === null) {
    return false;
  }

  activeTerminal.write(sequence);
  return true;
}

// Paste is routed separately from key sequences because only the pane knows
// whether its child enabled bracketed paste (DECSET 2004) and must wrap the
// payload accordingly.
let pasteHandler: ((text: string) => boolean) | null = null;

export function setStationTerminalPasteTarget(handler: ((text: string) => boolean) | null): void {
  pasteHandler = handler;
}

export function pasteToStationTerminal(text: string): boolean {
  if (pasteHandler === null) {
    return false;
  }
  return pasteHandler(text);
}

/**
 * Imperative teardown for shutdown paths: React unmount work scheduled by
 * root.unmount() never flushes before process.exit, so the live PTY must be
 * disposed directly or the shell only dies via the bridge's crash backstop.
 */
export function disposeActiveStationTerminal(): void {
  const terminal = activeTerminal;
  activeTerminal = null;
  pasteHandler = null;
  terminal?.dispose();
}
