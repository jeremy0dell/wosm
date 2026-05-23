import { describe, expect, it } from "vitest";
import {
  buildTmuxTargetId,
  buildWorkbenchWindowName,
  defaultTmuxWorkbenchConfig,
  defaultTmuxWorkbenchSessionOptions,
  parseTmuxTargetId,
  tmuxSessionOptionArgs,
} from "../../src/topology";

describe("tmux workbench topology", () => {
  it("uses the global wosm workbench defaults", () => {
    expect(defaultTmuxWorkbenchConfig).toMatchObject({
      topology: "workbench",
      workbenchSession: "wosm",
      windowNaming: "project-branch",
      primaryAgentPane: true,
      popupWidth: "50%",
      popupHeight: "50%",
      popupPosition: "C",
    });
  });

  it("applies Ghostty-like session options to the wosm workbench only", () => {
    expect(defaultTmuxWorkbenchSessionOptions).toEqual([
      { name: "mouse", value: "on" },
      { name: "history-limit", value: "100000" },
      { name: "set-clipboard", value: "on" },
    ]);
    expect(tmuxSessionOptionArgs("wosm", defaultTmuxWorkbenchSessionOptions[0])).toEqual([
      "set-option",
      "-t",
      "wosm",
      "mouse",
      "on",
    ]);
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
