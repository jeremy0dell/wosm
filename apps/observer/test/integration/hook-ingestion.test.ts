import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import {
  createFakeHarnessRun,
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
  it("persists a hook event, publishes it, and triggers reconciliation", async () => {
    const clock = { now: () => new Date(now) };
    const sqlite = openObserverSqlite({ clock });
    const persistence = createObserverPersistence({
      sqlite,
      clock,
      idFactory: ids(),
    });
    const eventBus = createObserverEventBus();
    const events = eventBus.subscribe()[Symbol.asyncIterator]();
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
      reconciled: true,
    });
    expect((await persistence.listEvents()).map((event) => event.type)).toEqual([
      "hook.ingested",
      "observer.reconciled",
    ]);
    await expect(nextEvent).resolves.toMatchObject({
      value: { type: "hook.ingested", provider: "worktrunk" },
    });
    await events.return?.();
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

    expect(receipt).toMatchObject({ status: "ingested", reconciled: true });
    expect(harness.ingestCalls).toBe(1);
    await expect(persistence.listProviderObservations()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "fake-harness",
          providerType: "harness",
          entityKind: "harness_event",
          entityKey: "run_hook_1",
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
