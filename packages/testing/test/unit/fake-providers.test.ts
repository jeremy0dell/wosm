import {
  createFakeHarnessRun,
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";

const now = "2026-05-20T12:00:00.000Z";

const project = {
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
};

describe("fake providers", () => {
  it("returns deterministic fake worktree observations scoped to the requested project", async () => {
    const provider = new FakeWorktreeProvider({
      now,
      worktrees: [
        createFakeWorktree({ id: "wt_web_main", projectId: "web", branch: "main", now }),
        createFakeWorktree({ id: "wt_api_main", projectId: "api", branch: "main", now }),
      ],
    });

    await expect(provider.listWorktrees(project)).resolves.toEqual([
      expect.objectContaining({
        id: "wt_web_main",
        projectId: "web",
        observedAt: now,
      }),
    ]);
    await expect(provider.health()).resolves.toMatchObject({
      providerId: "fake-worktree",
      providerType: "worktree",
      status: "healthy",
      lastCheckedAt: now,
    });
  });

  it("returns deterministic fake terminal and harness observations", async () => {
    const terminal = new FakeTerminalProvider({
      now,
      targets: [
        createFakeTerminalTarget({
          id: "term_web_main",
          projectId: "web",
          worktreeId: "wt_web_main",
          harnessRunId: "run_web_main",
          now,
        }),
      ],
    });
    const harness = new FakeHarnessProvider({
      now,
      runs: [
        createFakeHarnessRun({
          id: "run_web_main",
          projectId: "web",
          worktreeId: "wt_web_main",
          state: "working",
          now,
        }),
      ],
    });

    await expect(terminal.listTargets()).resolves.toEqual([
      expect.objectContaining({
        id: "term_web_main",
        provider: "fake-terminal",
        observedAt: now,
      }),
    ]);
    await expect(
      harness.discoverRuns({ projects: [project], worktrees: [], terminalTargets: [] }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "run_web_main",
        provider: "fake-harness",
        state: "working",
        observedAt: now,
      }),
    ]);
  });

  it("injects typed provider failures without changing fixture data", async () => {
    const provider = new FakeTerminalProvider({
      now,
      targets: [createFakeTerminalTarget({ id: "term_web_main", now })],
      failures: {
        listTargets: {
          tag: "TerminalProviderError",
          code: "FAKE_TERMINAL_LIST_FAILED",
          message: "The fake terminal provider failed to list targets.",
          provider: "fake-terminal",
        },
      },
    });

    await expect(provider.listTargets()).rejects.toMatchObject({
      tag: "TerminalProviderError",
      code: "FAKE_TERMINAL_LIST_FAILED",
      provider: "fake-terminal",
    });
    expect(provider.snapshot().targets).toHaveLength(1);
  });
});
