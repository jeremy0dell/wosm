import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  createFakeHarnessRun,
  createFakeTerminalTarget,
  createFakeWorktree,
  FakeHarnessProvider,
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

const now = "2026-05-20T12:00:00.000Z";

describe("observer hook ingestion", () => {
  it("persists a hook event, publishes it, and schedules reconciliation", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const events = eventBus.subscribe()[Symbol.asyncIterator]();
    const reconciled = nextObserverReconciled(eventBus);
    const core = createObserverCore({
      config,
      providers: new ProviderRegistry({
        worktree: new FakeWorktreeProvider({ now }),
        terminal: new FakeTerminalProvider({ now }),
        harnesses: [new FakeHarnessProvider({ now })],
      }),
      persistence,
      sqlite,
      clock,
    });
    const api = createObserverApi({
      core,
      persistence,
      commandQueue: createCommandQueue({ persistence, clock, idFactory: ids(), eventBus }),
      eventBus,
      clock,
      hookReconcileDebounceMs: 0,
    });
    const nextEvent = events.next();

    const receipt = await api.ingestHookEvent({
      schemaVersion: WOSM_SCHEMA_VERSION,
      provider: "worktrunk",
      kind: "worktree",
      event: "worktree.created",
      receivedAt: now,
    });

    expect(receipt).toMatchObject({
      accepted: true,
      status: "ingested",
      reconciled: false,
    });
    await expect(nextEvent).resolves.toMatchObject({
      value: { type: "hook.ingested", provider: "worktrunk" },
    });
    await expect(reconciled.next).resolves.toMatchObject({
      value: { type: "observer.reconciled" },
    });
    expect((await persistence.listEvents()).map((event) => event.type)).toEqual([
      "hook.ingested",
      "observer.reconciled",
    ]);
    await events.return?.();
    await reconciled.close();
    sqlite.close();
  });

  it("deduplicates hook ids before provider dispatch and persistence", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const reconciled = nextObserverReconciled(eventBus);
    const harness = new RecordingHarnessProvider({ now });
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [harness],
    });
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
      hookReconcileDebounceMs: 0,
    });
    const event = {
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_dedupe_1",
      provider: "fake-harness",
      kind: "harness" as const,
      event: "run.updated",
      receivedAt: now,
      payload: { state: "idle" },
    };

    const first = await api.ingestHookEvent(event);
    const second = await api.ingestHookEvent(event);

    expect(first).toMatchObject({ status: "ingested", deduped: false });
    expect(second).toMatchObject({ status: "ingested", deduped: true, reconciled: false });
    await expect(reconciled.next).resolves.toMatchObject({
      value: { type: "observer.reconciled" },
    });
    await reconciled.close();
    expect(harness.ingestCalls).toBe(1);
    expect(
      (await persistence.listEvents({ type: "hook.ingested" })).map((event) => event.event),
    ).toHaveLength(1);
    sqlite.close();
  });

  it("routes harness hook events through provider ingest and stores normalized observations", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const reconciled = nextObserverReconciled(eventBus);
    const harness = new RecordingHarnessProvider({ now });
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [harness],
    });
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
      hookReconcileDebounceMs: 0,
    });

    const receipt = await api.ingestHookEvent({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_harness_1",
      provider: "fake-harness",
      kind: "harness",
      event: "run.updated",
      receivedAt: now,
      worktreeId: "wt_web_feature_auth",
      sessionId: "ses_web_feature_auth",
      payload: { state: "idle" },
    });

    expect(receipt).toMatchObject({ status: "ingested", reconciled: false });
    await expect(reconciled.next).resolves.toMatchObject({
      value: { type: "observer.reconciled" },
    });
    await reconciled.close();
    expect(harness.ingestCalls).toBe(1);
    await expect(persistence.listProviderObservations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "fake-harness",
          providerType: "harness",
          entityKind: "harness_event",
          entityKey: "run_hook_1",
          expiresAt: "2026-06-03T12:00:00.000Z",
          payload: expect.objectContaining({
            provider: "fake-harness",
            harnessRunId: "run_hook_1",
            status: expect.objectContaining({
              source: "harness_hook",
              value: "idle",
            }),
          }),
        }),
      ]),
    );
    sqlite.close();
  });

  it("passes persisted worktree and terminal context to harness hook ingest", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const reconciled = nextObserverReconciled(eventBus);
    const worktree = createFakeWorktree({
      id: "wt_web_feature_auth",
      projectId: "web",
      branch: "feature/auth",
      path: "/tmp/wosm/web/feature-auth",
      now,
    });
    const terminal = createFakeTerminalTarget({
      id: "term_web_feature_auth",
      projectId: "web",
      worktreeId: "wt_web_feature_auth",
      sessionId: "ses_web_feature_auth",
      harnessRunId: "run_hook_1",
      now,
      providerData: {
        harness: "fake-harness",
        role: "main-agent",
      },
    });
    await persistence.persistReconcileResult({
      projects: providerProjects,
      worktrees: [worktree],
      terminalTargets: [terminal],
      harnessRuns: [],
      observedAt: now,
    });

    const harness = new ContextRecordingHarnessProvider({ now });
    const providers = new ProviderRegistry({
      worktree: new FakeWorktreeProvider({ now }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [harness],
    });
    const core = createObserverCore({
      config: projectConfig,
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
      config: projectConfig,
      hookReconcileDebounceMs: 0,
    });

    await api.ingestHookEvent({
      schemaVersion: WOSM_SCHEMA_VERSION,
      hookId: "hook_context_1",
      provider: "fake-harness",
      kind: "harness",
      event: "run.updated",
      receivedAt: now,
      payload: { state: "needs_attention" },
    });

    expect(harness.lastContext).toMatchObject({
      projects: [{ id: "web" }],
      worktrees: [{ id: "wt_web_feature_auth" }],
      terminalTargets: [{ id: "term_web_feature_auth" }],
    });
    await expect(reconciled.next).resolves.toMatchObject({
      value: { type: "observer.reconciled" },
    });
    await reconciled.close();
    sqlite.close();
  });
});

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [],
};

const providerProjects = [
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
];

const projectConfig: WosmConfig = {
  ...config,
  projects: providerProjects,
};

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

function nextObserverReconciled(eventBus: ReturnType<typeof createObserverEventBus>) {
  const events = eventBus.subscribe({ type: "observer.reconciled" })[Symbol.asyncIterator]();
  return {
    next: events.next(),
    close: async () => {
      await events.return?.();
    },
  };
}

class RecordingHarnessProvider extends FakeHarnessProvider {
  ingestCalls = 0;

  constructor(options: ConstructorParameters<typeof FakeHarnessProvider>[0]) {
    super({
      ...options,
      runs: [
        createFakeHarnessRun({
          id: "run_hook_1",
          worktreeId: "wt_web_feature_auth",
          sessionId: "ses_web_feature_auth",
          state: "idle",
          now,
        }),
      ],
    });
  }

  override async ingestEvent() {
    this.ingestCalls += 1;
    return [
      {
        provider: this.id,
        harnessRunId: "run_hook_1",
        worktreeId: "wt_web_feature_auth",
        sessionId: "ses_web_feature_auth",
        rawEventType: "run.updated",
        status: {
          value: "idle",
          confidence: "high",
          reason: "Fake harness hook reported idle.",
          source: "harness_hook",
          updatedAt: now,
        },
        observedAt: now,
      },
    ];
  }
}

class ContextRecordingHarnessProvider extends FakeHarnessProvider {
  lastContext: Parameters<NonNullable<FakeHarnessProvider["ingestEvent"]>>[1] | undefined;

  override async ingestEvent(
    event: Parameters<NonNullable<FakeHarnessProvider["ingestEvent"]>>[0],
    context: Parameters<NonNullable<FakeHarnessProvider["ingestEvent"]>>[1],
  ) {
    this.lastContext = context;
    return super.ingestEvent(event, context);
  }
}
