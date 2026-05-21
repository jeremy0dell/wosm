import type { TerminalProvider } from "@wosm/contracts";
import {
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import {
  createObserverCore,
  createTerminalFocusHandler,
  ProviderRegistry,
} from "../../src/internal";

const now = "2026-05-21T12:00:00.000Z";

describe("observer terminal commands", () => {
  it("focuses a target resolved from worktreeId without exposing tmux details", async () => {
    const focused: string[] = [];
    const terminal = new RecordingTerminalProvider({
      id: "tmux",
      now,
      targets: [
        createFakeTerminalTarget({
          id: "tmux:wosm:@1:%2",
          provider: "tmux",
          projectId: "web",
          worktreeId: "wt_web_feature",
          sessionId: "ses_web_feature",
          now,
          providerData: {
            sessionId: "wosm",
            windowId: "@1",
            paneId: "%2",
          },
        }),
      ],
      focused,
    });
    const core = createObserverCore({
      config,
      providers: new ProviderRegistry({
        worktree: new FakeWorktreeProvider({
          now,
          worktrees: [
            createFakeWorktree({
              id: "wt_web_feature",
              projectId: "web",
              branch: "feature",
              now,
            }),
          ],
        }),
        terminal,
        harnesses: [new FakeHarnessProvider({ now })],
      }),
      clock: { now: () => new Date(now) },
    });

    await core.reconcile("terminal-focus-test");
    const handler = createTerminalFocusHandler({ core, terminal });

    await handler({
      commandId: "cmd_1",
      trace: { traceId: "trc_1", spanId: "spn_1", operation: "command.terminal.focus" },
      command: {
        type: "terminal.focus",
        payload: {
          worktreeId: "wt_web_feature",
        },
      },
      signal: new AbortController().signal,
    });

    expect(focused).toEqual(["tmux:wosm:@1:%2"]);
  });

  it("throws a safe terminal provider error when the target cannot be resolved", async () => {
    const terminal = new RecordingTerminalProvider({ id: "tmux", now, targets: [], focused: [] });
    const core = createObserverCore({
      config,
      providers: new ProviderRegistry({
        worktree: new FakeWorktreeProvider({ now }),
        terminal,
        harnesses: [new FakeHarnessProvider({ now })],
      }),
      clock: { now: () => new Date(now) },
    });
    const handler = createTerminalFocusHandler({ core, terminal });

    await expect(
      handler({
        commandId: "cmd_1",
        trace: { traceId: "trc_1", spanId: "spn_1", operation: "command.terminal.focus" },
        command: {
          type: "terminal.focus",
          payload: {
            worktreeId: "wt_missing",
          },
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      tag: "TerminalProviderError",
      code: "TERMINAL_TARGET_MISSING",
      provider: "tmux",
      worktreeId: "wt_missing",
    });
  });
});

class RecordingTerminalProvider extends FakeTerminalProvider implements TerminalProvider {
  readonly #focused: string[];

  constructor(
    options: ConstructorParameters<typeof FakeTerminalProvider>[0] & { focused: string[] },
  ) {
    super(options);
    this.#focused = options.focused;
  }

  override async focusTarget(targetId: string): Promise<void> {
    await super.focusTarget(targetId);
    this.#focused.push(targetId);
  }
}

const config = {
  schemaVersion: 1 as const,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "tmux",
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
        terminal: "tmux",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
  ],
};
