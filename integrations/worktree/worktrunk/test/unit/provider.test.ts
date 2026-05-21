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

  it("aborts Worktrunk subprocesses on timeout with a typed provider error", async () => {
    let aborted = false;
    const provider = new WorktrunkProvider({
      command: "wt",
      timeoutMs: 5,
      clock: { now: () => new Date(now) },
      runner: async (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
          });
        }),
    });

    await expect(provider.listWorktrees(project)).rejects.toMatchObject({
      tag: "WorktreeProviderError",
      code: "WORKTRUNK_TIMEOUT",
    });
    expect(aborted).toBe(true);
  });

  it("maps invalid create output to a WorktrunkProviderError", async () => {
    const provider = new WorktrunkProvider({
      command: "wt",
      clock: { now: () => new Date(now) },
      runner: async (input) => result(input, "{not-json"),
    });

    await expect(provider.createWorktree({ project, branch: "feature" })).rejects.toMatchObject({
      tag: "WorktreeProviderError",
      code: "WORKTRUNK_INVALID_OUTPUT",
    });
  });

  it("retries safe reads but not create commands", async () => {
    let listCalls = 0;
    const provider = new WorktrunkProvider({
      command: "wt",
      clock: { now: () => new Date(now) },
      runner: async (input) => {
        if (input.args?.includes("list")) {
          listCalls += 1;
          if (listCalls === 1) {
            throw Object.assign(new Error("temporary"), { code: "EAGAIN" });
          }
          return result(
            input,
            JSON.stringify([{ path: "/tmp/wosm/web/feature", branch: "feature" }]),
          );
        }
        if (input.args?.includes("switch")) {
          throw Object.assign(new Error("temporary"), { code: "EAGAIN" });
        }
        return result(input, "wt 0.0.0");
      },
    });

    await expect(provider.listWorktrees(project)).resolves.toHaveLength(1);
    await expect(provider.createWorktree({ project, branch: "feature" })).rejects.toMatchObject({
      tag: "WorktreeProviderError",
      code: "WORKTRUNK_COMMAND_FAILED",
    });
    expect(listCalls).toBe(2);
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
