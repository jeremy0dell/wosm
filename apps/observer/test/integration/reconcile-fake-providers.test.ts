import type { WosmConfig } from "@wosm/config";
import { WosmSnapshotSchema } from "@wosm/contracts";
import {
  createFakeHarnessRun,
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createObserverCore, ProviderRegistry } from "../../src";

const now = "2026-05-20T12:00:00.000Z";

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [
    {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "fake-harness",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
    {
      id: "api",
      label: "api",
      root: "/tmp/wosm/api",
      defaults: {
        harness: "fake-harness",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
    {
      id: "mobile",
      label: "mobile",
      root: "/tmp/wosm/mobile",
      defaults: {
        harness: "fake-harness",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
  ],
};

describe("observer reconcile with fake providers", () => {
  it("correlates configured projects, fake observations, provider health, and timing", async () => {
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({
        now,
        worktrees: [
          createFakeWorktree({ id: "wt_web_idle", projectId: "web", branch: "idle", now }),
          createFakeWorktree({ id: "wt_api_working", projectId: "api", branch: "working", now }),
          createFakeWorktree({
            id: "wt_api_unknown",
            projectId: "api",
            branch: "unknown",
            now,
          }),
        ],
      }),
      terminal: new FakeTerminalProvider({
        now,
        targets: [
          createFakeTerminalTarget({
            id: "term_web_idle",
            projectId: "web",
            worktreeId: "wt_web_idle",
            sessionId: "ses_web_idle",
            harnessRunId: "run_web_idle",
            now,
          }),
          createFakeTerminalTarget({
            id: "term_api_working",
            projectId: "api",
            worktreeId: "wt_api_working",
            sessionId: "ses_api_working",
            harnessRunId: "run_api_working",
            now,
          }),
          createFakeTerminalTarget({
            id: "term_api_unknown",
            projectId: "api",
            worktreeId: "wt_api_unknown",
            sessionId: "ses_api_unknown",
            harnessRunId: "run_api_unknown",
            state: "unknown",
            confidence: "low",
            reason: "Conflicting provider observations.",
            now,
          }),
          createFakeTerminalTarget({
            id: "term_orphan",
            state: "open",
            confidence: "low",
            reason: "No matching configured project.",
            now,
          }),
        ],
      }),
      harnesses: [
        new FakeHarnessProvider({
          now,
          runs: [
            createFakeHarnessRun({
              id: "run_web_idle",
              projectId: "web",
              worktreeId: "wt_web_idle",
              sessionId: "ses_web_idle",
              state: "idle",
              now,
            }),
            createFakeHarnessRun({
              id: "run_api_working",
              projectId: "api",
              worktreeId: "wt_api_working",
              sessionId: "ses_api_working",
              state: "working",
              now,
            }),
            createFakeHarnessRun({
              id: "run_api_unknown",
              projectId: "api",
              worktreeId: "wt_api_unknown",
              sessionId: "ses_api_unknown",
              state: "unknown",
              confidence: "low",
              reason: "Conflicting provider observations.",
              now,
            }),
          ],
        }),
      ],
    });

    const core = createObserverCore({
      config,
      providers,
      clock: {
        now: () => new Date(now),
      },
    });

    const snapshot = await core.reconcile("integration-test");
    const health = core.getHealth();

    expect(WosmSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.projects.map((project) => project.id)).toEqual(["web", "api", "mobile"]);
    expect(snapshot.projects.find((project) => project.id === "mobile")?.counts.worktrees).toBe(0);
    expect(snapshot.rows.map((row) => row.id)).toEqual([
      "wt_web_idle",
      "wt_api_working",
      "wt_api_unknown",
    ]);
    expect(snapshot.rows.find((row) => row.id === "wt_api_unknown")?.display).toMatchObject({
      statusLabel: "unknown",
      alert: false,
      warning: true,
    });
    expect(snapshot.orphans).toEqual([
      expect.objectContaining({
        kind: "terminal_target",
        terminalTargetId: "term_orphan",
      }),
    ]);
    expect(snapshot.providerHealth["fake-worktree"]?.status).toBe("healthy");
    expect(snapshot.providerHealth["fake-terminal"]?.status).toBe("healthy");
    expect(snapshot.providerHealth["fake-harness"]?.status).toBe("healthy");
    expect(health.lastReconcile).toMatchObject({
      reason: "integration-test",
      projectsScanned: 3,
      worktreesObserved: 3,
      terminalTargetsObserved: 4,
      harnessRunsObserved: 3,
    });
    expect(health.lastReconcile?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("maps provider failures into health and keeps a valid snapshot", async () => {
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({
        now,
        failures: {
          listWorktrees: {
            tag: "WorktreeProviderError",
            code: "FAKE_WORKTREE_LIST_FAILED",
            message: "The fake worktree provider failed to list worktrees.",
            provider: "fake-worktree",
          },
        },
      }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [new FakeHarnessProvider({ now })],
    });
    const core = createObserverCore({
      config,
      providers,
      clock: {
        now: () => new Date(now),
      },
    });

    const snapshot = await core.reconcile("provider-failure");

    expect(WosmSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.observer.healthy).toBe(false);
    expect(snapshot.providerHealth["fake-worktree"]).toMatchObject({
      status: "unavailable",
      lastError: {
        code: "FAKE_WORKTREE_LIST_FAILED",
      },
    });
    expect(snapshot.alerts).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "FAKE_WORKTREE_LIST_FAILED",
        provider: "fake-worktree",
      }),
    ]);
  });
});
