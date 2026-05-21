import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { WorktrunkProvider } from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";

const now = "2026-05-21T12:00:00.000Z";
const project = {
  id: "web",
  label: "web",
  root: "/tmp/wosm/web",
  defaults: {
    harness: "codex",
    terminal: "tmux",
    layout: "agent-shell",
  },
  worktrunk: {
    enabled: true,
    base: "main",
  },
};

describe("WorktrunkProvider", () => {
  it("lists worktrees through strict argv arrays", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new WorktrunkProvider({
      command: "wt",
      configPath: "/tmp/wt/config.toml",
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        calls.push(input);
        return result(
          input,
          JSON.stringify([{ path: "/tmp/wosm/web/feature", branch: "feature" }]),
        );
      },
    });

    const observations = await provider.listWorktrees(project);

    expect(observations[0]).toMatchObject({
      id: "wt_web_feature",
      branch: "feature",
      observedAt: now,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        command: "wt",
        args: ["--config", "/tmp/wt/config.toml", "list", "--format=json"],
        cwd: "/tmp/wosm/web",
      }),
    ]);
  });

  it("creates and removes worktrees using Worktrunk lifecycle commands", async () => {
    const calls: ExternalCommandInput[] = [];
    const provider = new WorktrunkProvider({
      command: "wt",
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        calls.push(input);
        if (input.args?.[0] === "switch") {
          return result(
            input,
            JSON.stringify([{ path: "/tmp/wosm/web/feature", branch: "feature" }]),
          );
        }
        if (input.args?.[0] === "remove") {
          return result(input, "{}");
        }
        return result(
          input,
          JSON.stringify([{ path: "/tmp/wosm/web/feature", branch: "feature" }]),
        );
      },
    });

    const created = await provider.createWorktree({ project, branch: "feature" });
    const removed = await provider.removeWorktree({ worktreeId: created.id });

    expect(removed).toEqual({ worktreeId: "wt_web_feature", removed: true });
    expect(calls.map((call) => call.args)).toEqual([
      ["switch", "--create", "feature", "--base", "main", "--no-cd", "--format=json"],
      ["remove", "feature", "--foreground", "--format=json"],
    ]);
  });

  it("reports unavailable health when the wt binary is missing", async () => {
    const provider = new WorktrunkProvider({
      command: "missing-wt",
      clock: { now: () => new Date(now) },
      runner: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
    });

    await expect(provider.health()).resolves.toMatchObject({
      status: "unavailable",
      lastError: {
        tag: "ProviderUnavailableError",
        code: "WORKTRUNK_UNAVAILABLE",
      },
    });
  });
});

function result(input: ExternalCommandInput, stdout: string): ExternalCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    stdout,
    stderr: "",
    exitCode: 0,
  };
}
