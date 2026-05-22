import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticEvidenceIndex } from "@wosm/contracts";
import { writeDebugBundle } from "@wosm/observability";
import { describe, expect, it } from "vitest";
import {
  baseDiagnosticSnapshot,
  baseWosmSnapshot,
  diagnosticNow,
  readBundleJson,
} from "../../support/diagnostics";

describe("row-level provider diagnostics from debug bundles", () => {
  it("answers common provider questions without a TUI inspect panel", async () => {
    const diagnosticsDir = await mkdtemp(join(tmpdir(), "wosm-row-provider-"));
    const manifest = await writeDebugBundle({
      diagnosticsDir,
      now: new Date(diagnosticNow),
      bundleId: "diag_row_provider",
      snapshot: baseDiagnosticSnapshot({
        snapshot: baseWosmSnapshot({
          rows: [
            {
              id: "wt_web_debug",
              projectId: "web",
              projectLabel: "web",
              branch: "feature/debug",
              path: "/tmp/wosm/web/debug",
              worktree: { state: "exists", source: "worktrunk", dirty: true },
              terminal: {
                provider: "tmux",
                state: "open",
                workspaceTargetId: "tmux:%2.4",
                primaryAgentTargetId: "tmux:%2.4",
              },
              agent: {
                harness: "codex",
                state: "working",
                runId: "run_codex_1",
                confidence: "medium",
                reason: "Codex run is active.",
                updatedAt: diagnosticNow,
              },
              display: {
                statusLabel: "working",
                sortPriority: 30,
                alert: false,
              },
            },
          ],
        }),
      }),
    });

    const index = await readBundleJson<DiagnosticEvidenceIndex>(
      manifest.bundlePath,
      "diagnostic-index.json",
    );
    expect(index.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "row-wt_web_debug-provider",
          answer: expect.stringContaining("worktree source worktrunk"),
        }),
        expect.objectContaining({
          id: "row-wt_web_debug-terminal-target",
          answer: expect.stringContaining("tmux:%2.4"),
        }),
        expect.objectContaining({
          id: "row-wt_web_debug-agent-run",
          answer: expect.stringContaining("run_codex_1"),
        }),
      ]),
    );
  });
});
