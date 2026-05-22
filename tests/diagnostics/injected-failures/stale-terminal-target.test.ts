import { buildDiagnosticEvidenceIndex } from "@wosm/observability";
import { describe, expect, it } from "vitest";
import { baseDiagnosticSnapshot, baseWosmSnapshot, diagnosticNow } from "../../support/diagnostics";

describe("stale terminal target diagnostic", () => {
  it("answers the failed terminal target and row from snapshot and command evidence", () => {
    const index = buildDiagnosticEvidenceIndex(
      baseDiagnosticSnapshot({
        snapshot: baseWosmSnapshot({
          rows: [
            {
              id: "wt_web_stale",
              projectId: "web",
              projectLabel: "web",
              branch: "feature/stale-terminal",
              path: "/tmp/wosm/web/stale-terminal",
              worktree: { state: "exists", source: "worktrunk" },
              terminal: {
                provider: "tmux",
                state: "stale",
                workspaceTargetId: "tmux:%1.9",
                primaryAgentTargetId: "tmux:%1.9",
              },
              display: {
                statusLabel: "unknown",
                sortPriority: 50,
                alert: false,
                warning: true,
                reason: "Terminal target is stale.",
              },
            },
          ],
        }),
        commands: [
          {
            id: "cmd_focus_1",
            type: "terminal.focus",
            command: {
              type: "terminal.focus",
              payload: { worktreeId: "wt_web_stale" },
            },
            status: "failed",
            createdAt: diagnosticNow,
            error: {
              tag: "TerminalProviderError",
              code: "TERMINAL_TARGET_STALE",
              message: "The terminal target is stale.",
              provider: "tmux",
              worktreeId: "wt_web_stale",
              diagnosticId: "err_terminal",
            },
          },
        ],
      }),
    );

    expect(index.summary.rootCauseCodes).toContain("STALE_TERMINAL_TARGET");
    expect(index.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "row-wt_web_stale-provider",
          answer: expect.stringContaining("tmux"),
        }),
        expect.objectContaining({
          id: "row-wt_web_stale-terminal-target",
          answer: expect.stringContaining("tmux:%1.9"),
        }),
      ]),
    );
  });
});
