import type { WosmConfig } from "@wosm/config";
import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../../src/providers/factory";

const now = "2026-05-21T12:00:00.000Z";

describe("provider factory", () => {
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
