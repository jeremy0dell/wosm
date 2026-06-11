import type { StationTerminalProcess } from "./types.js";

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
