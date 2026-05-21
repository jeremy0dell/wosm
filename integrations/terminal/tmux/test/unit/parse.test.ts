import { TerminalTargetObservationSchema } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { parseTmuxTargetLines } from "../../src/parse";

const now = "2026-05-21T12:00:00.000Z";

describe("tmux target parser", () => {
  it("normalizes workbench pane output into TerminalTargetObservation values", () => {
    const targets = parseTmuxTargetLines(
      [
        [
          "wosm",
          "@1",
          "%2",
          "1",
          "/tmp/wosm/web/feature",
          "12345",
          "web-feature",
          "ses_web_feature",
          "web",
          "wt_web_feature",
          "main-agent",
          "codex",
        ].join("\t"),
      ].join("\n"),
      { observedAt: now },
    );

    expect(targets).toHaveLength(1);
    expect(TerminalTargetObservationSchema.parse(targets[0])).toEqual(targets[0]);
    expect(targets[0]).toMatchObject({
      id: "tmux:wosm:@1:%2",
      provider: "tmux",
      projectId: "web",
      worktreeId: "wt_web_feature",
      sessionId: "ses_web_feature",
      state: "open",
      cwd: "/tmp/wosm/web/feature",
      pid: 12345,
      title: "web-feature",
      confidence: "high",
      reason: "tmux pane has wosm identity binding.",
      providerData: {
        sessionId: "wosm",
        windowId: "@1",
        paneId: "%2",
        role: "main-agent",
        harness: "codex",
        attached: true,
      },
    });
  });

  it("keeps unbound panes low-confidence and provider-specific", () => {
    const targets = parseTmuxTargetLines(
      ["wosm", "@1", "%3", "0", "/tmp/random", "", "scratch", "", "", "", "", ""].join("\t"),
      { observedAt: now },
    );

    expect(targets).toEqual([
      expect.objectContaining({
        id: "tmux:wosm:@1:%3",
        state: "detached",
        confidence: "low",
        reason: "tmux pane is missing wosm identity binding.",
        providerData: expect.objectContaining({
          sessionId: "wosm",
          windowId: "@1",
          paneId: "%3",
          attached: false,
        }),
      }),
    ]);
  });
});
