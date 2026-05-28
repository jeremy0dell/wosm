import type { DashboardInputEvent } from "./types.js";

export function isReturnInput(event: DashboardInputEvent): boolean {
  return event.key.return === true || event.input === "\r" || event.input === "\n";
}
