import { CodexHarnessProvider } from "@wosm/codex";
import type { WosmConfig } from "@wosm/config";
import {
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import { createObserverCore, ProviderRegistry } from "../../src/internal";

const now = "2026-05-21T12:00:00.000Z";

describe("observer reconcile with Codex harness", () => {
  it("observes a tmux-bound Codex target as a provider-neutral harness run", async () => {
    const provider = new CodexHarnessProvider({
      now: () => new Date(now),
      runner: async (input) => ({
        command: input.command,
        args: input.args ?? [],
        stdout: "Logged in with ChatGPT\n",
        stderr: "",
        exitCode: 0,
      }),
    });
    const core = createObserverCore({
      config,
      providers: new ProviderRegistry({
        worktree: new FakeWorktreeProvider({
          now,
          worktrees: [
            createFakeWorktree({
              id: "wt_web_task",
              projectId: "web",
              branch: "task",
              path: "/tmp/wosm/web/task",
              now,
            }),
          ],
        }),
        terminal: new FakeTerminalProvider({
          now,
          targets: [
            createFakeTerminalTarget({
              id: "tmux:wosm:@1:%2",
              provider: "tmux",
              projectId: "web",
              worktreeId: "wt_web_task",
              sessionId: "ses_web_task",
              now,
              providerData: {
                sessionId: "wosm",
                windowId: "@1",
                paneId: "%2",
                role: "main-agent",
                harness: "codex",
                currentCommand: "codex",
              },
            }),
          ],
        }),
        harnesses: [provider],
      }),
      clock: {
        now: () => new Date(now),
      },
    });

    const snapshot = await core.reconcile("codex-terminal-binding");

    expect(snapshot.rows[0]?.agent).toMatchObject({
      harness: "codex",
      state: "unknown",
      confidence: "low",
      sessionId: "ses_web_task",
    });
    expect(snapshot.sessions[0]).toMatchObject({
      id: "ses_web_task",
      harness: {
        provider: "codex",
      },
    });
    expect(snapshot.providerHealth.codex).toMatchObject({
      status: "healthy",
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
