// Mouse plumbing for the WOSM view: renderables read one dispatch function
// from context and report {target, eventKind}; the Station input runtime
// routes it (routeMouse -> wosm bindings -> routeWosmMouse). Hit-testing and
// wheel-direction reading happen here at the renderable edge — the router
// never inspects event payloads. The default is a no-op so pure render
// tests (goldens) need no provider.
import { createContext, useContext } from "react";
import type { MouseEvent } from "@opentui/core";
import type { WosmMouseEventKind, WosmMouseTarget } from "../input/wosmMouse.js";

export type WosmMouseDispatch = (target: WosmMouseTarget, eventKind: WosmMouseEventKind) => void;

const WosmMouseContext = createContext<WosmMouseDispatch>(() => {});

export const WosmMouseProvider = WosmMouseContext.Provider;

export function useWosmMouse(): WosmMouseDispatch {
  return useContext(WosmMouseContext);
}

/** onMouseDown/onMouseScroll handlers for a target, stopping propagation so
 * outer surfaces (the body wheel area, Station's pane box) don't double-route. */
export function wosmMouseProps(
  dispatch: WosmMouseDispatch,
  target: WosmMouseTarget,
): {
  onMouseDown: (event: MouseEvent) => void;
  onMouseScroll: (event: MouseEvent) => void;
} {
  return {
    onMouseDown: (event) => {
      event.stopPropagation();
      dispatch(target, "down");
    },
    onMouseScroll: (event) => {
      const direction = event.scroll?.direction;
      if (direction !== "up" && direction !== "down") {
        return;
      }
      event.stopPropagation();
      dispatch(target, direction === "up" ? "scroll-up" : "scroll-down");
    },
  };
}
