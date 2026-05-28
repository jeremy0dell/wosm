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

  it("orders harness providers from defaults, project defaults, and harness config", () => {
    const registry = createProviderRegistry({
      ...config,
      projects: [
        firstProject(),
        {
          id: "api",
          label: "api",
          root: "/tmp/wosm/api",
          defaults: {
            harness: "opencode",
            terminal: "fake-terminal",
            layout: "agent-shell",
          },
          worktrunk: {
            enabled: true,
          },
        },
      ],
      harness: {
        pi: {},
        scripted: {},
      },
    });

    expect([...registry.harnesses.keys()]).toEqual(["codex", "opencode", "pi", "scripted"]);
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
          installHooks: true,
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
        "wosm",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
      ],
    });
  });

  it("registers Pi harness provider with command and observer config path", async () => {
    const registry = createProviderRegistry(
      {
        ...config,
        defaults: {
          ...config.defaults,
          harness: "pi",
        },
        harness: {
          pi: {
            command: "pi-custom",
          },
        },
        projects: [
          {
            ...firstProject(),
            defaults: {
              harness: "pi",
              terminal: "fake-terminal",
              layout: "agent-shell",
            },
          },
        ],
      },
      { configPath: "/tmp/wosm/config.toml" },
    );
    const provider = registry.harnesses.get("pi");
    const project = firstProject();

    await expect(
      provider?.buildLaunch({
        project: {
          ...project,
          defaults: {
            harness: "pi",
            terminal: "fake-terminal",
            layout: "agent-shell",
          },
        },
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
      provider: "pi",
      command: "pi-custom",
      args: expect.arrayContaining(["--extension"]),
      env: {
        WOSM_CONFIG_PATH: "/tmp/wosm/config.toml",
      },
    });
  });

  it("registers GitHub as an optional repository provider without eager health alerts", async () => {
    const registry = createProviderRegistry(config);
    const provider = registry.repositories.get("github");

    await expect(provider?.health()).resolves.toMatchObject({
      providerId: "github",
      providerType: "repository",
      status: "unknown",
    });
  });

  it("allows GitHub repository enrichment to be disabled", () => {
    const registry = createProviderRegistry({
      ...config,
      repository: {
        github: {
          enabled: false,
        },
      },
    });

    expect(registry.repositories.size).toBe(0);
  });

  it("applies global yolo harness permission mode to Codex launches", async () => {
    const registry = createProviderRegistry({
      ...config,
      defaults: {
        ...config.defaults,
        harnessPermissionMode: "yolo",
      },
      harness: {
        codex: {
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

    const plan = await provider?.buildLaunch({
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
    });

    expect(plan?.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(plan?.providerData).toMatchObject({
      permissionMode: "yolo",
    });
    expect(plan?.args).not.toContain("--sandbox");
    expect(plan?.args).not.toContain("--ask-for-approval");
  });

  it("treats legacy explicit Codex yolo config as yolo permission mode", async () => {
    const registry = createProviderRegistry({
      ...config,
      harness: {
        codex: {
          approvalPolicy: "never",
          sandboxMode: "danger-full-access",
        },
      },
    });
    const provider = registry.harnesses.get("codex");
    const project = config.projects[0];
    if (project === undefined) {
      throw new Error("provider factory fixture is missing a project.");
    }

    const plan = await provider?.buildLaunch({
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
    });

    expect(plan?.args).toEqual([
      "--cd",
      "/tmp/wosm/web/task",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(plan?.providerData).toMatchObject({
      permissionMode: "yolo",
    });
  });

  it("lets provider permission mode override the global harness permission mode", async () => {
    const registry = createProviderRegistry({
      ...config,
      defaults: {
        ...config.defaults,
        harnessPermissionMode: "yolo",
      },
      harness: {
        codex: {
          permissionMode: "standard",
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
      args: [
        "--cd",
        "/tmp/wosm/web/task",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
      ],
      providerData: {
        permissionMode: "standard",
        approvalPolicy: "on-request",
        sandboxMode: "workspace-write",
      },
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
