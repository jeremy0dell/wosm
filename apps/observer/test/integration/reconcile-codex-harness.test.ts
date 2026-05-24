import { CodexHarnessProvider } from "@wosm/codex";
import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import {
  createCommandQueue,
  createObserverApi,
  createObserverCore,
  createObserverEventBus,
  createObserverPersistence,
  openObserverSqlite,
  ProviderRegistry,
} from "../../src/internal";

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

  it("applies correlated Codex hook events to the rendered row state", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const providers = codexProviders();
    const core = createObserverCore({
      config,
      providers,
      persistence,
      sqlite,
      clock,
    });
    const api = createObserverApi({
      core,
      providers,
      persistence,
      commandQueue: createCommandQueue({ persistence, clock, idFactory: ids(), eventBus }),
      eventBus,
      clock,
      config,
    });
    await core.reconcile("initial-codex-context");

    const receipt = await api.ingestHookEvent({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_codex_working",
      provider: "codex",
      kind: "harness",
      event: "PreToolUse",
      receivedAt: "2026-05-21T12:00:01.000Z",
      payload: {
        session_id: "codex_session_123",
        transcript_path: null,
        cwd: "/tmp/wosm/web/task/src",
        hook_event_name: "PreToolUse",
        model: "gpt-5.4-codex",
        permission_mode: "default",
        turn_id: "turn_1",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_use_id: "call_test",
      },
    });

    expect(receipt).toMatchObject({
      status: "ingested",
      reconciled: true,
    });
    expect(core.getSnapshot().rows[0]?.agent).toMatchObject({
      harness: "codex",
      state: "working",
      confidence: "medium",
      sessionId: "ses_web_task",
    });
    expect(core.getSnapshot().rows[0]?.id).toBe("wt_web_task");
    expect(core.getSnapshot().counts).toMatchObject({
      working: 1,
      attention: 0,
    });
    sqlite.close();
  });
});

function codexProviders(): ProviderRegistry {
  return new ProviderRegistry({
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
    harnesses: [
      new CodexHarnessProvider({
        now: () => new Date(now),
        runner: async (input) => ({
          command: input.command,
          args: input.args ?? [],
          stdout: "Logged in with ChatGPT\n",
          stderr: "",
          exitCode: 0,
        }),
      }),
    ],
  });
}

function ids() {
  let command = 0;
  let event = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    commandId: () => `cmd_${++command}`,
    eventId: () => `evt_${++event}`,
    observationId: () => `obs_${++observation}`,
    breadcrumbId: () => `crumb_${++breadcrumb}`,
  };
}

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
