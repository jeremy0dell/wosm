import type { WosmConfig } from "@wosm/config";
import type { BuildHarnessLaunchRequest, HarnessLaunchPlan } from "@wosm/contracts";
import {
  createFakeHarnessRun,
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import {
  createCommandQueue,
  createObserverCore,
  createObserverEventBus,
  createObserverPersistence,
  openObserverSqlite,
  ProviderRegistry,
  registerObserverCommandHandlers,
} from "../../src/internal";

const now = "2026-05-21T12:00:00.000Z";

describe("session command vertical slice", () => {
  it("creates a session, launches the primary agent target, reconciles, and focuses it", async () => {
    const harness = new FakeHarnessProvider({
      now,
      runs: [
        createFakeHarnessRun({
          id: "run_web_feature",
          projectId: "web",
          worktreeId: "wt_web_feature",
          sessionId: "ses_web_feature",
          state: "idle",
          now,
        }),
      ],
    });
    const terminal = new FakeTerminalProvider({ now });
    const fixture = createFixture({
      terminal,
      harness,
      sessionIds: ["ses_web_feature"],
    });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "feature",
        harness: {
          provider: "fake-harness",
          mode: "interactive",
          profile: "default",
        },
        terminal: {
          provider: "fake-terminal",
          layout: "agent-build-shell",
          focus: true,
        },
        initialPrompt: "Start the feature.",
      },
    });
    await fixture.queue.drain();

    expect(receipt).toMatchObject({ accepted: true, status: "accepted" });
    expect(terminal.snapshot().launches).toHaveLength(1);
    expect(terminal.snapshot().focused).toEqual(["term_fake"]);
    expect(fixture.core.getSnapshot().sessions).toEqual([
      expect.objectContaining({
        id: "ses_web_feature",
        projectId: "web",
        worktreeId: "wt_web_feature",
      }),
    ]);
    expect(fixture.core.getSnapshot().rows[0]?.agent).toMatchObject({
      sessionId: "ses_web_feature",
      state: "idle",
    });
    expect(
      (await fixture.persistence.listEvents({ commandId: receipt.commandId })).map(
        (event) => event.type,
      ),
    ).toEqual(["command.accepted", "command.started", "session.created", "command.succeeded"]);
    expect(await fixture.persistence.listEvents({ type: "session.created" })).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          type: "session.created",
          session: expect.objectContaining({
            id: "ses_web_feature",
          }),
        }),
      }),
    ]);
    fixture.sqlite.close();
  });

  it("passes the opened terminal target into harness launch construction", async () => {
    const harness = new CapturingHarnessProvider({ now });
    const fixture = createFixture({
      terminal: new FakeTerminalProvider({ now }),
      harness,
      sessionIds: ["ses_web_feature"],
    });

    await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "feature",
        harness: {
          provider: "fake-harness",
          mode: "interactive",
        },
        terminal: {
          provider: "fake-terminal",
          layout: "agent-build-shell",
        },
      },
    });
    await fixture.queue.drain();

    expect(harness.lastBuildRequest?.terminalTarget).toMatchObject({
      id: "term_fake",
      provider: "fake-terminal",
      projectId: "web",
      worktreeId: "wt_web_feature",
      sessionId: "ses_web_feature",
      state: "open",
    });
    fixture.sqlite.close();
  });

  it("creates a session in the background when terminal focus is false", async () => {
    const harness = new FakeHarnessProvider({
      now,
      runs: [
        createFakeHarnessRun({
          id: "run_web_feature",
          projectId: "web",
          worktreeId: "wt_web_feature",
          sessionId: "ses_web_feature",
          state: "idle",
          now,
        }),
      ],
    });
    const terminal = new FakeTerminalProvider({ now });
    const fixture = createFixture({
      terminal,
      harness,
      sessionIds: ["ses_web_feature"],
    });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "feature",
        harness: {
          provider: "fake-harness",
          mode: "interactive",
        },
        terminal: {
          provider: "fake-terminal",
          layout: "agent-build-shell",
          focus: false,
        },
      },
    });
    await fixture.queue.drain();

    expect(receipt).toMatchObject({ accepted: true, status: "accepted" });
    expect(terminal.snapshot().launches).toHaveLength(1);
    expect(terminal.snapshot().focused).toEqual([]);
    expect(fixture.core.getSnapshot().rows[0]?.agent).toMatchObject({
      sessionId: "ses_web_feature",
      state: "idle",
    });
    fixture.sqlite.close();
  });

  it("maps session.create provider failure to SafeError and diagnostic envelope", async () => {
    const fixture = createFixture({
      worktree: new FakeWorktreeProvider({
        now,
        failures: {
          createWorktree: {
            tag: "WorktreeProviderError",
            code: "FAKE_WORKTREE_CREATE_FAILED",
            message: "The fake worktree provider could not create the worktree.",
            provider: "fake-worktree",
          },
        },
      }),
      sessionIds: ["ses_failed"],
    });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "broken",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        tag: "WorktreeProviderError",
        code: "FAKE_WORKTREE_CREATE_FAILED",
        provider: "fake-worktree",
        commandId: receipt.commandId,
        traceId: receipt.traceId,
      },
    });
    expect(await fixture.persistence.listCommandErrors(receipt.commandId)).toEqual([
      expect.objectContaining({
        commandId: receipt.commandId,
        envelope: expect.objectContaining({
          code: "FAKE_WORKTREE_CREATE_FAILED",
          provider: "fake-worktree",
        }),
      }),
    ]);
    fixture.sqlite.close();
  });

  it("removes a created worktree when session.create cannot open a terminal", async () => {
    const worktree = new FakeWorktreeProvider({ now });
    const terminal = new FakeTerminalProvider({
      now,
      failures: {
        openWorkspace: {
          tag: "TerminalProviderError",
          code: "FAKE_TERMINAL_OPEN_FAILED",
          message: "The fake terminal provider could not open the workspace.",
          provider: "fake-terminal",
        },
      },
    });
    const fixture = createFixture({ worktree, terminal, sessionIds: ["ses_cleanup_open"] });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "cleanup-open",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "FAKE_TERMINAL_OPEN_FAILED",
        provider: "fake-terminal",
      },
    });
    expect(worktree.snapshot().removed).toEqual([
      {
        projectId: "web",
        worktreeId: "wt_web_cleanup_open",
        force: true,
      },
    ]);
    expect(worktree.snapshot().worktrees).toEqual([]);
    fixture.sqlite.close();
  });

  it("closes the opened terminal and removes the worktree when harness build fails", async () => {
    const worktree = new FakeWorktreeProvider({ now });
    const terminal = new FakeTerminalProvider({ now });
    const harness = new FakeHarnessProvider({
      now,
      failures: {
        buildLaunch: {
          tag: "HarnessProviderError",
          code: "FAKE_HARNESS_BUILD_FAILED",
          message: "The fake harness provider could not build a launch plan.",
          provider: "fake-harness",
        },
      },
    });
    const fixture = createFixture({
      worktree,
      terminal,
      harness,
      sessionIds: ["ses_cleanup_build"],
    });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "cleanup-build",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "FAKE_HARNESS_BUILD_FAILED",
        provider: "fake-harness",
      },
    });
    expect(terminal.snapshot().closed).toEqual(["term_fake"]);
    expect(worktree.snapshot().removed).toEqual([
      {
        projectId: "web",
        worktreeId: "wt_web_cleanup_build",
        force: true,
      },
    ]);
    fixture.sqlite.close();
  });

  it("cleans up pre-launch resources when terminal launch fails", async () => {
    const worktree = new FakeWorktreeProvider({ now });
    const terminal = new FakeTerminalProvider({
      now,
      failures: {
        launchProcess: {
          tag: "TerminalProviderError",
          code: "FAKE_TERMINAL_LAUNCH_FAILED",
          message: "The fake terminal provider could not launch the process.",
          provider: "fake-terminal",
        },
      },
    });
    const fixture = createFixture({ worktree, terminal, sessionIds: ["ses_cleanup_launch"] });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "cleanup-launch",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "FAKE_TERMINAL_LAUNCH_FAILED",
        provider: "fake-terminal",
      },
    });
    expect(terminal.snapshot().closed).toEqual(["term_fake"]);
    expect(worktree.snapshot().removed).toEqual([
      {
        projectId: "web",
        worktreeId: "wt_web_cleanup_launch",
        force: true,
      },
    ]);
    fixture.sqlite.close();
  });

  it("does not fail session.create when focus fails after launch", async () => {
    const terminal = new FakeTerminalProvider({
      now,
      failures: {
        focusTarget: {
          tag: "TerminalProviderError",
          code: "FAKE_TERMINAL_FOCUS_FAILED",
          message: "The fake terminal provider could not focus the target.",
          provider: "fake-terminal",
        },
      },
    });
    const harness = new FakeHarnessProvider({
      now,
      runs: [
        createFakeHarnessRun({
          id: "run_web_focus",
          projectId: "web",
          worktreeId: "wt_web_focus",
          sessionId: "ses_focus",
          state: "idle",
          now,
        }),
      ],
    });
    const fixture = createFixture({ terminal, harness, sessionIds: ["ses_focus"] });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "focus",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal", focus: true },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(terminal.snapshot().launches).toHaveLength(1);
    expect(terminal.snapshot().focused).toEqual([]);
    expect(fixture.core.getSnapshot().rows[0]?.agent).toMatchObject({
      sessionId: "ses_focus",
      state: "idle",
    });
    fixture.sqlite.close();
  });

  it("starts an agent on an existing no-agent worktree", async () => {
    const harness = new FakeHarnessProvider({ now });
    const terminal = new FakeTerminalProvider({
      now,
      onLaunch: async ({ launchPlan }) => {
        harness.addRun(
          createFakeHarnessRun({
            id: "run_web_existing",
            projectId: "web",
            worktreeId: "wt_web_existing",
            sessionId: launchPlan.env?.WOSM_SESSION_ID,
            state: "working",
            now,
          }),
        );
      },
    });
    const fixture = createFixture({
      terminal,
      harness,
      worktree: new FakeWorktreeProvider({
        now,
        worktrees: [
          createFakeWorktree({
            id: "wt_web_existing",
            projectId: "web",
            branch: "existing",
            now,
          }),
        ],
      }),
      sessionIds: ["ses_existing"],
    });
    await fixture.core.reconcile("pre-start-agent");

    await fixture.queue.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_existing",
        harness: { provider: "fake-harness", mode: "interactive" },
        terminal: { provider: "fake-terminal", focus: false },
      },
    });
    await fixture.queue.drain();

    expect(terminal.snapshot().launches).toHaveLength(1);
    expect(terminal.snapshot().focused).toEqual([]);
    expect(fixture.core.getSnapshot().rows[0]?.agent).toMatchObject({
      sessionId: "ses_existing",
      state: "working",
    });
    fixture.sqlite.close();
  });

  it("rejects session.startAgent when a primary agent already exists", async () => {
    const fixture = createFixture({
      worktree: new FakeWorktreeProvider({
        now,
        worktrees: [
          createFakeWorktree({ id: "wt_web_busy", projectId: "web", branch: "busy", now }),
        ],
      }),
      terminal: new FakeTerminalProvider({ now }),
      harness: new FakeHarnessProvider({
        now,
        runs: [
          createFakeHarnessRun({
            id: "run_web_busy",
            projectId: "web",
            worktreeId: "wt_web_busy",
            sessionId: "ses_web_busy",
            state: "working",
            now,
          }),
        ],
      }),
      sessionIds: ["ses_rejected"],
    });
    await fixture.core.reconcile("busy");

    const receipt = await fixture.queue.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_busy",
        harness: { provider: "fake-harness" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        tag: "CommandValidationError",
        code: "SESSION_ALREADY_HAS_AGENT",
        worktreeId: "wt_web_busy",
        sessionId: "ses_web_busy",
      },
    });
    fixture.sqlite.close();
  });

  it("closes the terminal opened by session.startAgent when launch setup fails", async () => {
    const worktree = new FakeWorktreeProvider({
      now,
      worktrees: [
        createFakeWorktree({
          id: "wt_web_cleanup_start",
          projectId: "web",
          branch: "cleanup-start",
          now,
        }),
      ],
    });
    const terminal = new FakeTerminalProvider({ now });
    const harness = new FakeHarnessProvider({
      now,
      failures: {
        buildLaunch: {
          tag: "HarnessProviderError",
          code: "FAKE_HARNESS_BUILD_FAILED",
          message: "The fake harness provider could not build a launch plan.",
          provider: "fake-harness",
        },
      },
    });
    const fixture = createFixture({
      worktree,
      terminal,
      harness,
      sessionIds: ["ses_cleanup_start"],
    });
    await fixture.core.reconcile("pre-start-agent-cleanup");

    const receipt = await fixture.queue.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_cleanup_start",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "FAKE_HARNESS_BUILD_FAILED",
        provider: "fake-harness",
      },
    });
    expect(terminal.snapshot().closed).toEqual(["term_fake"]);
    expect(worktree.snapshot().removed).toEqual([]);
    fixture.sqlite.close();
  });

  it("preserves the original command error when cleanup also fails", async () => {
    const worktree = new FakeWorktreeProvider({ now });
    const terminal = new FakeTerminalProvider({
      now,
      failures: {
        closeTarget: {
          tag: "TerminalProviderError",
          code: "FAKE_TERMINAL_CLOSE_FAILED",
          message: "The fake terminal provider could not close the target.",
          provider: "fake-terminal",
        },
      },
    });
    const harness = new FakeHarnessProvider({
      now,
      failures: {
        buildLaunch: {
          tag: "HarnessProviderError",
          code: "FAKE_HARNESS_BUILD_FAILED",
          message: "The fake harness provider could not build a launch plan.",
          provider: "fake-harness",
        },
      },
    });
    const fixture = createFixture({
      worktree,
      terminal,
      harness,
      sessionIds: ["ses_cleanup_failure"],
    });

    const receipt = await fixture.queue.dispatch({
      type: "session.create",
      payload: {
        projectId: "web",
        branch: "cleanup-failure",
        harness: { provider: "fake-harness" },
        terminal: { provider: "fake-terminal" },
      },
    });
    await fixture.queue.drain();

    await expect(fixture.persistence.getCommand(receipt.commandId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "FAKE_HARNESS_BUILD_FAILED",
        provider: "fake-harness",
      },
    });
    expect(worktree.snapshot().removed).toEqual([
      {
        projectId: "web",
        worktreeId: "wt_web_cleanup_failure",
        force: true,
      },
    ]);
    fixture.sqlite.close();
  });

  it("serializes conflicting start-agent commands by worktree", async () => {
    let releaseFirst = () => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const launchOrder: string[] = [];
    const terminal = new FakeTerminalProvider({
      now,
      onLaunch: async ({ launchPlan }) => {
        launchOrder.push(launchPlan.env?.WOSM_SESSION_ID ?? "missing");
        if (launchOrder.length === 1) {
          await firstBlocked;
        }
      },
    });
    const fixture = createFixture({
      terminal,
      worktree: new FakeWorktreeProvider({
        now,
        worktrees: [
          createFakeWorktree({ id: "wt_web_serial", projectId: "web", branch: "serial", now }),
        ],
      }),
      sessionIds: ["ses_serial_1", "ses_serial_2"],
    });
    await fixture.core.reconcile("serial");

    const first = fixture.queue.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_serial",
        harness: { provider: "fake-harness" },
      },
    });
    const second = fixture.queue.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: "web",
        worktreeId: "wt_web_serial",
        harness: { provider: "fake-harness" },
      },
    });
    await Promise.all([first, second]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(launchOrder).toEqual(["ses_serial_1"]);

    releaseFirst();
    await fixture.queue.drain();

    expect(launchOrder).toEqual(["ses_serial_1", "ses_serial_2"]);
    fixture.sqlite.close();
  });
});

function createFixture(
  options: {
    worktree?: FakeWorktreeProvider;
    terminal?: FakeTerminalProvider;
    harness?: FakeHarnessProvider;
    sessionIds?: string[];
  } = {},
) {
  const clock = { now: () => new Date(now) };
  const sqlite = openObserverSqlite({ clock });
  const ids = observerIds();
  const persistence = createObserverPersistence({ sqlite, clock, idFactory: ids });
  const eventBus = createObserverEventBus();
  const queue = createCommandQueue({ persistence, clock, idFactory: ids, eventBus });
  const providers = new ProviderRegistry({
    worktree: options.worktree ?? new FakeWorktreeProvider({ now }),
    terminal: options.terminal ?? new FakeTerminalProvider({ now }),
    harnesses: [options.harness ?? new FakeHarnessProvider({ now })],
  });
  const core = createObserverCore({
    config,
    providers,
    persistence,
    sqlite,
    clock,
  });
  const sessionIds = [...(options.sessionIds ?? [])];
  registerObserverCommandHandlers({
    queue,
    core,
    providers,
    projects: config.projects,
    persistence,
    eventBus,
    clock,
    idFactory: {
      sessionId: () => sessionIds.shift() ?? "ses_fallback",
    },
  });
  return { sqlite, persistence, eventBus, queue, providers, core };
}

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
  ],
};

function observerIds() {
  let command = 0;
  let event = 0;
  let error = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    commandId: () => `cmd_${++command}`,
    eventId: () => `evt_${++event}`,
    errorId: () => `err_${++error}`,
    observationId: () => `obs_${++observation}`,
    breadcrumbId: () => `crumb_${++breadcrumb}`,
  };
}

class CapturingHarnessProvider extends FakeHarnessProvider {
  lastBuildRequest: BuildHarnessLaunchRequest | undefined;

  override async buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan> {
    this.lastBuildRequest = request;
    return super.buildLaunch(request);
  }
}
