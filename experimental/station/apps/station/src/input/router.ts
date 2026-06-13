import type { FocusTarget, OverlayId, PaneId, PaneRole, StationState } from "../state/types.js";
import type { WosmMouseEventKind, WosmMouseTarget } from "../wosm/input/wosmMouse.js";
import type { KeymapStack } from "./keymaps.js";

export type StationCommandId = "station.exit";

/**
 * The router's complete outcome vocabulary. This union is deliberately
 * closed: new behavior is expressed as new commands or store actions, not
 * new outcome kinds, so the executor stays a fixed table.
 *
 * "swallowed" is consumed with no effect (modal layers eating input);
 * "ignored" is NOT consumed - the sequence handler returns false and
 * OpenTUI's own handlers may still act on the input.
 */
export type RouteOutcome =
  | { kind: "command"; commandId: StationCommandId }
  | { kind: "terminal-write"; paneId: PaneId; bytes: string }
  | { kind: "terminal-paste"; paneId: PaneId; text: string }
  | { kind: "focus"; target: FocusTarget }
  | { kind: "overlay-open"; overlayId: OverlayId }
  | { kind: "overlay-close"; overlayId: OverlayId }
  /**
   * Open-or-focus a pane rooted at `cwd`. Its own outcome kind rather than a
   * StationCommandId because commands take no arguments; the executor resolves
   * the cwd into a pane via the registry + store. `role` distinguishes the
   * `[+sh]` shell from a worktree session's primary agent; the agent carries
   * its harness `command`/`args` and `worktreeId` (absent for shells).
   */
  | {
      kind: "pane-open";
      paneId: PaneId;
      cwd: string;
      role: PaneRole;
      command?: string;
      args?: readonly string[];
      worktreeId?: string;
    }
  | { kind: "swallowed" }
  | { kind: "ignored" };

export type MouseTargetRef =
  | { kind: "header" }
  | { kind: "pane"; paneId: PaneId }
  /**
   * A WOSM dashboard surface. The view's renderables own hit-testing and
   * wheel-direction reading, so the inner target + event kind ride in the
   * ref; routing itself still never inspects event payloads.
   */
  | { kind: "wosm"; target: WosmMouseTarget; eventKind: WosmMouseEventKind };

/** Routing never reads event payloads in Phase 1; hit-testing is the framework's job. */
export type StationMouseEvent = unknown;

/**
 * One handler per mouse target kind, declared next to the key bindings so a
 * new mouse target is a table entry. The switch in routeMouse is mechanical
 * dispatch; TypeScript exhaustiveness forces the table to grow with the
 * target union.
 */
export type MouseBindings = {
  header: (target: Extract<MouseTargetRef, { kind: "header" }>, state: StationState) => RouteOutcome;
  pane: (target: Extract<MouseTargetRef, { kind: "pane" }>, state: StationState) => RouteOutcome;
  wosm: (target: Extract<MouseTargetRef, { kind: "wosm" }>, state: StationState) => RouteOutcome;
};

export function routeKey(
  key: string,
  state: StationState,
  keymap: KeymapStack<RouteOutcome>,
): RouteOutcome {
  return keymap.resolve(key, state) ?? { kind: "ignored" };
}

export function routeMouse(
  target: MouseTargetRef,
  _event: StationMouseEvent,
  state: StationState,
  bindings: MouseBindings,
): RouteOutcome {
  switch (target.kind) {
    case "header":
      return bindings.header(target, state);
    case "pane":
      return bindings.pane(target, state);
    case "wosm":
      return bindings.wosm(target, state);
  }
}

/**
 * Paste is a separate dispatch from key sequences (OpenTUI routes paste
 * around the sequence handlers, and only the pane knows its bracketed-paste
 * state). It routes by focus: pane focus delivers, anything modal ignores
 * so the event stays un-prevented for OpenTUI's own paste handling.
 */
export function routePaste(text: string, state: StationState): RouteOutcome {
  if (state.input.activeOverlay !== null || state.input.dialogStack.length > 0) {
    return { kind: "ignored" };
  }
  const focus = state.input.focus;
  if (focus.kind !== "pane") {
    return { kind: "ignored" };
  }
  return { kind: "terminal-paste", paneId: focus.paneId, text };
}
