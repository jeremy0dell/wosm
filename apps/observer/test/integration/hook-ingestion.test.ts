import type { WosmConfig } from "@wosm/config";
import { WOSM_SCHEMA_VERSION } from "@wosm/contracts";
import { FakeHarnessProvider, FakeTerminalProvider, FakeWorktreeProvider } from "@wosm/testing";
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
