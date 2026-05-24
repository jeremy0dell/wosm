import type { WosmConfig } from "@wosm/config";
import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../../src/providers/factory";

const now = "2026-05-21T12:00:00.000Z";

describe("provider factory", () => {
  it("keeps explicit noop providers healthy for empty/test startup", async () => {
    const registry = createProviderRegistry({
      ...config,
      defaults: {
        worktreeProvider: "noop-worktree",
        terminal: "noop-terminal",
        harness: "noop-harness",
        layout: "agent-shell",
      },
      projects: [],
    });
    const harness = registry.harnesses.get("noop-harness");
    if (harness === undefined) {
      throw new Error("noop harness provider was not registered.");
    }
    const project = firstProject();

    await expect(registry.worktree.health()).resolves.toMatchObject({
      providerId: "noop-worktree",
      status: "healthy",
    });
    await expect(registry.terminal.health()).resolves.toMatchObject({
      providerId: "noop-terminal",
      status: "healthy",
    });
    await expect(harness.health()).resolves.toMatchObject({
      providerId: "noop-harness",
      status: "healthy",
    });
    expect(await registry.worktree.listWorktrees(project)).toEqual([]);
    expect(await registry.terminal.listTargets()).toEqual([]);
    expect(
      await harness.discoverRuns({ projects: [], worktrees: [], terminalTargets: [] }),
    ).toEqual([]);
  });

  it("reports unknown configured provider ids as unavailable", async () => {
    const registry = createProviderRegistry({
      ...config,
      defaults: {
        worktreeProvider: "codxe",
        terminal: "tmxu",
        harness: "harnes",
        layout: "agent-shell",
      },
      projects: [
        {
          ...firstProject(),
          defaults: {
            harness: "harnes",
            terminal: "tmxu",
            layout: "agent-shell",
          },
        },
      ],
    });
    const harness = registry.harnesses.get("harnes");
    if (harness === undefined) {
      throw new Error("unknown harness provider was not registered.");
    }

    await expect(registry.worktree.health()).resolves.toMatchObject({
      providerId: "codxe",
      providerType: "worktree",
      status: "unavailable",
      lastError: {
        tag: "ProviderUnavailableError",
        code: "PROVIDER_NOT_REGISTERED",
        provider: "codxe",
      },
      capabilities: {
        canList: false,
      },
    });
    await expect(registry.terminal.health()).resolves.toMatchObject({
      providerId: "tmxu",
      providerType: "terminal",
      status: "unavailable",
      lastError: {
        tag: "ProviderUnavailableError",
        code: "PROVIDER_NOT_REGISTERED",
        provider: "tmxu",
      },
    });
    await expect(harness.health()).resolves.toMatchObject({
      providerId: "harnes",
      providerType: "harness",
      status: "unavailable",
      lastError: {
        tag: "ProviderUnavailableError",
        code: "PROVIDER_NOT_REGISTERED",
        provider: "harnes",
      },
      capabilities: {
        canDiscoverRuns: false,
      },
    });
    await expect(registry.worktree.listWorktrees(firstProject())).resolves.toEqual([]);
    await expect(registry.terminal.listTargets()).resolves.toEqual([]);
    await expect(
      harness.discoverRuns({ projects: [], worktrees: [], terminalTargets: [] }),
    ).resolves.toEqual([]);
    await expect(registry.terminal.openWorkspace({} as never)).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED",
      provider: "tmxu",
    });
    await expect(harness.buildLaunch({} as never)).rejects.toMatchObject({
      code: "PROVIDER_NOT_REGISTERED",
      provider: "harnes",
    });
  });

  it("passes Codex config defaults into the Codex harness provider", async () => {
    const registry = createProviderRegistry({
      ...config,
      harness: {
        codex: {
          command: "codex-custom",
          profile: "team-profile",
          approvalPolicy: "on-request",
          sandboxMode: "workspace-write",
        },
      },
    });
    const provider = registry.harnesses.get("codex");
    const project = config.projects[0];
    if (project === undefined) {
      throw new Error("provider factory fixture is missing a project.");
    }

    await expect(
      provider?.buildLaunch({
        project,
        worktree: {
          id: "wt_web_task",
          provider: "worktrunk",
          projectId: "web",
          branch: "task",
          path: "/tmp/wosm/web/task",
          state: "exists",
          source: "worktrunk",
          observedAt: now,
        },
        mode: "interactive",
      }),
    ).resolves.toMatchObject({
      command: "codex-custom",
      args: [
        "--cd",
        "/tmp/wosm/web/task",
        "--profile",
        "team-profile",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
      ],
    });
  });
});

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "codex",
    layout: "agent-shell",
  },
  projects: [
    {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaults: {
        harness: "codex",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
  ],
};

function firstProject(): WosmConfig["projects"][number] {
  const project = config.projects[0];
  if (project === undefined) {
    throw new Error("provider factory fixture is missing a project.");
  }
  return project;
}
