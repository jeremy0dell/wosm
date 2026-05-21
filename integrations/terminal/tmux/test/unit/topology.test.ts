import { describe, expect, it } from "vitest";
import {
  buildTmuxTargetId,
  buildWorkbenchWindowName,
  defaultTmuxWorkbenchConfig,
  parseTmuxTargetId,
} from "../../src/topology";

describe("tmux workbench topology", () => {
  it("uses the global wosm workbench defaults", () => {
    expect(defaultTmuxWorkbenchConfig).toMatchObject({
      topology: "workbench",
      workbenchSession: "wosm",
      windowNaming: "project-branch",
      primaryAgentPane: true,
      popupWidth: "95%",
      popupHeight: "85%",
      popupPosition: "C",
    });
  });

  it("builds stable safe window names from project and branch", () => {
    expect(
      buildWorkbenchWindowName({
        projectId: "web",
        branch: "feat/auth refresh!",
      }),
    ).toBe("web-feat-auth-refresh");
    expect(
      buildWorkbenchWindowName({
        projectId: "api",
        branch: "very/long/branch/name/with/many/parts/and-symbols",
      }).length,
    ).toBeLessThanOrEqual(48);
  });

  it("round-trips opaque provider target IDs without making core parse tmux fields", () => {
    const id = buildTmuxTargetId({
      sessionId: "wosm",
      windowId: "@12",
      paneId: "%34",
    });

    expect(id).toBe("tmux:wosm:@12:%34");
    expect(parseTmuxTargetId(id)).toEqual({
      sessionId: "wosm",
      windowId: "@12",
      paneId: "%34",
    });
  });
});
