import { componentLogPath, createJsonlLogger, type JsonlLogger } from "@wosm/observability";
import type { RuntimeClock } from "@wosm/runtime";

export function createObserverLogger(input: {
  stateDir: string;
  clock?: RuntimeClock;
}): JsonlLogger {
  return createJsonlLogger({
    component: "observer",
    path: componentLogPath(input.stateDir, "observer"),
    ...(input.clock === undefined ? {} : { clock: input.clock }),
  });
}
