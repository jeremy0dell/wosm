import { readFile } from "node:fs/promises";
import {
  CommandRecordSchema,
  ErrorEnvelopeSchema,
  EventFilterSchema,
  HarnessCapabilitiesSchema,
  HarnessEventObservationSchema,
  HarnessLaunchPlanSchema,
  HarnessRunObservationSchema,
  HarnessStatusObservationSchema,
  HookReceiptSchema,
  HookSpoolRecordSchema,
  ObserverHealthSchema,
  ObserverStopReceiptSchema,
  type ProjectId,
  ProjectIdSchema,
  ProviderHealthSchema,
  ProviderHookEventSchema,
  ProviderProjectConfigSchema,
  ReconcileReceiptSchema,
  SafeErrorSchema,
  TerminalCapabilitiesSchema,
  TerminalIdentityBindingSchema,
  TerminalTargetObservationSchema,
  WOSM_SCHEMA_VERSION,
  WorktreeCapabilitiesSchema,
  type WorktreeId,
  WorktreeObservationSchema,
  WosmCommandSchema,
  WosmEventSchema,
  WosmSnapshotSchema,
} from "@wosm/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ZodType } from "zod";

const fixtureUrl = (path: string) =>
  new URL(`../../../../tests/contract-fixtures/${path}`, import.meta.url);

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl(path), "utf8"));
}

function expectParses(schema: ZodType, value: unknown, label: string) {
  const result = schema.safeParse(value);
  expect(result.success, `${label}: ${result.success ? "" : result.error.message}`).toBe(true);
}

function expectFails(schema: ZodType, value: unknown, label: string) {
  const result = schema.safeParse(value);
  expect(result.success, `${label} unexpectedly parsed`).toBe(false);
}

describe("Phase 1 contract schemas", () => {
  it("keeps id aliases distinct while preserving string wire values", () => {
    const projectId: ProjectId = "project_api";

    expect(ProjectIdSchema.parse("project_api")).toBe("project_api");
    expectTypeOf<ProjectId>().not.toEqualTypeOf<WorktreeId>();
    expectTypeOf(projectId).toEqualTypeOf<ProjectId>();
  });

  it("exports the shared schema version used by snapshot fixtures", async () => {
    expect(WOSM_SCHEMA_VERSION).toBe("0.3.0");

    const snapshots = (await loadJson("snapshots/snapshot-scenarios.json")) as Record<
      string,
      { schemaVersion?: unknown }
    >;

    for (const [name, snapshot] of Object.entries(snapshots)) {
      expect(snapshot.schemaVersion, name).toBe(WOSM_SCHEMA_VERSION);
    }
  });

  it("parses valid snapshot scenarios and rejects invalid snapshots", async () => {
    const snapshots = (await loadJson("snapshots/snapshot-scenarios.json")) as Record<
      string,
      unknown
    >;

    expect(Object.keys(snapshots).sort()).toEqual([
      "exitedAgent",
      "idleAgent",
      "multipleProjects",
      "needsAttentionAgent",
      "noAgentWorktree",
      "noProjects",
      "orphanedTerminalTarget",
      "providerFailure",
      "stuckAgent",
      "unknownLowConfidence",
      "workingAgent",
      "zeroWorktreeProject",
    ]);

    for (const [name, snapshot] of Object.entries(snapshots)) {
      expectParses(WosmSnapshotSchema, snapshot, `snapshot fixture ${name}`);
    }

    expectFails(
      WosmSnapshotSchema,
      await loadJson("snapshots/invalid-snapshot.json"),
      "invalid snapshot fixture",
    );
  });

  it("parses one command fixture for each command union member", async () => {
    const commands = (await loadJson("commands/commands.json")) as Record<string, unknown>;

    for (const [name, command] of Object.entries(commands)) {
      expectParses(WosmCommandSchema, command, `command fixture ${name}`);
    }

    const commandTypes = Object.values(commands)
      .map((command) => (command as { type: string }).type)
      .sort();

    expect(commandTypes).toEqual([
      "hooks.install",
      "observer.reconcile",
      "session.close",
      "session.create",
      "session.remove",
      "session.sendPrompt",
      "session.startAgent",
      "terminal.focus",
      "worktree.create",
      "worktree.remove",
    ]);

    expectFails(
      WosmCommandSchema,
      await loadJson("commands/invalid-command.json"),
      "invalid command fixture",
    );
  });

  it("parses one event fixture for each event union member", async () => {
    const events = (await loadJson("events/events.json")) as Record<string, unknown>;

    for (const [name, event] of Object.entries(events)) {
      expectParses(WosmEventSchema, event, `event fixture ${name}`);
    }

    const eventTypes = Object.values(events)
      .map((event) => (event as { type: string }).type)
      .sort();

    expect(eventTypes).toEqual([
      "command.accepted",
      "command.failed",
      "command.started",
      "command.succeeded",
      "hook.ingested",
      "hook.spoolDrained",
      "observer.reconciled",
      "observer.started",
      "project.updated",
      "provider.healthChanged",
      "session.created",
      "session.removed",
      "session.updated",
      "worktree.added",
      "worktree.agentStateChanged",
      "worktree.removed",
      "worktree.updated",
    ]);

    expectFails(WosmEventSchema, await loadJson("events/invalid-event.json"), "invalid event");
  });

  it("parses Phase 5 hook, observer, command-record, and event-filter contracts", async () => {
    const hookEvents = (await loadJson("hooks/provider-hook-events.json")) as Record<
      string,
      unknown
    >;
    const firstHookEvent = Object.values(hookEvents)[0];
    const snapshot = (await loadJson("snapshots/snapshot-scenarios.json")) as Record<
      string,
      unknown
    >;

    for (const [name, hookEvent] of Object.entries(hookEvents)) {
      expectParses(ProviderHookEventSchema, hookEvent, `hook event ${name}`);
    }

    expectFails(
      ProviderHookEventSchema,
      await loadJson("hooks/invalid-provider-hook-event.json"),
      "invalid hook event",
    );

    expectParses(
      HookReceiptSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: "hook_1",
        provider: "worktrunk",
        event: "worktree.created",
        accepted: true,
        status: "ingested",
        receivedAt: "2026-05-20T12:02:00.000Z",
        reconciled: true,
      },
      "hook receipt",
    );

    expectParses(
      HookSpoolRecordSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        spoolId: "spool_1",
        createdAt: "2026-05-20T12:02:01.000Z",
        event: firstHookEvent,
        attempts: 0,
      },
      "hook spool record",
    );

    expectParses(
      ObserverHealthSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        status: "healthy",
        pid: 1234,
        startedAt: "2026-05-20T12:00:00.000Z",
        version: "0.0.0",
        socketPath: "/tmp/wosm/observer.sock",
        stateDir: "/tmp/wosm/state",
        hookSpoolDepth: 0,
      },
      "observer health",
    );

    expectParses(
      ObserverStopReceiptSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        stopped: true,
        at: "2026-05-20T12:05:00.000Z",
      },
      "observer stop receipt",
    );

    expectParses(
      ReconcileReceiptSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        reason: "contract-test",
        reconciledAt: "2026-05-20T12:05:00.000Z",
        snapshot: snapshot.noProjects,
      },
      "reconcile receipt",
    );

    expectParses(
      CommandRecordSchema,
      {
        id: "cmd_1",
        type: "observer.reconcile",
        command: {
          type: "observer.reconcile",
          payload: {
            reason: "contract-test",
          },
        },
        status: "succeeded",
        createdAt: "2026-05-20T12:00:00.000Z",
        startedAt: "2026-05-20T12:00:00.100Z",
        finishedAt: "2026-05-20T12:00:00.200Z",
      },
      "command record",
    );

    expectParses(
      EventFilterSchema,
      {
        type: ["command.accepted", "hook.ingested"],
        since: "2026-05-20T12:00:00.000Z",
      },
      "event filter",
    );
  });

  it("keeps SafeError safe while allowing rich internal ErrorEnvelope diagnostics", async () => {
    const errors = (await loadJson("errors/errors.json")) as Record<string, unknown>;

    expectParses(SafeErrorSchema, errors.safeError, "safe error");
    expectParses(ErrorEnvelopeSchema, errors.errorEnvelope, "error envelope");

    expectFails(
      SafeErrorSchema,
      await loadJson("errors/unsafe-safe-error.json"),
      "unsafe safe error fixture",
    );
    expectFails(
      SafeErrorSchema,
      {
        tag: "ExternalCommandError",
        code: "EXTERNAL_COMMAND_FAILED",
        message: "External command failed.\n    at run (/tmp/internal.ts:10:1)",
      },
      "stack-like SafeError message",
    );
  });

  it("parses provider health, capabilities, observations, and providerData boundaries", async () => {
    const observations = (await loadJson("provider-observations/observations.json")) as Record<
      string,
      unknown
    >;

    expectParses(
      WorktreeCapabilitiesSchema,
      observations.worktreeCapabilities,
      "worktree capabilities",
    );
    expectParses(
      TerminalCapabilitiesSchema,
      observations.terminalCapabilities,
      "terminal capabilities",
    );
    expectParses(
      HarnessCapabilitiesSchema,
      observations.harnessCapabilities,
      "harness capabilities",
    );
    expectParses(ProviderHealthSchema, observations.providerHealth, "provider health");
    expectParses(
      ProviderProjectConfigSchema,
      {
        id: "api",
        label: "API",
        root: "/tmp/api",
        defaults: {
          harness: "scripted",
          terminal: "tmux",
          layout: "agent-shell",
        },
        worktrunk: {
          enabled: true,
          base: "main",
        },
        recoveryBreadcrumbs: {
          location: "worktree",
          path: ".wosm/recovery-breadcrumb.json",
        },
      },
      "provider project config",
    );
    expectFails(
      ProviderProjectConfigSchema,
      {
        id: "api",
        label: "API",
        root: "/tmp/api",
        defaults: {
          harness: "scripted",
          terminal: "tmux",
          layout: "agent-shell",
        },
        worktrunk: {
          enabled: true,
        },
        providerSpecific: true,
      },
      "provider project config with provider-specific data",
    );
    expectParses(HarnessLaunchPlanSchema, observations.harnessLaunchPlan, "harness launch plan");

    for (const [index, observation] of (observations.worktreeObservations as unknown[]).entries()) {
      expectParses(WorktreeObservationSchema, observation, `worktree observation ${index}`);
    }

    for (const [index, observation] of (
      observations.terminalTargetObservations as unknown[]
    ).entries()) {
      expectParses(
        TerminalTargetObservationSchema,
        observation,
        `terminal target observation ${index}`,
      );
    }

    for (const [index, observation] of (
      observations.harnessRunObservations as unknown[]
    ).entries()) {
      expectParses(HarnessRunObservationSchema, observation, `harness run observation ${index}`);
    }

    for (const [index, observation] of (
      observations.harnessStatusObservations as unknown[]
    ).entries()) {
      expectParses(
        HarnessStatusObservationSchema,
        observation,
        `harness status observation ${index}`,
      );
    }

    for (const [index, observation] of (
      observations.harnessEventObservations as unknown[]
    ).entries()) {
      expectParses(
        HarnessEventObservationSchema,
        observation,
        `harness event observation ${index}`,
      );
    }

    for (const [index, observation] of (
      observations.terminalIdentityBindings as unknown[]
    ).entries()) {
      expectParses(TerminalIdentityBindingSchema, observation, `terminal identity ${index}`);
    }

    expectFails(
      TerminalTargetObservationSchema,
      await loadJson("provider-observations/invalid-observation.json"),
      "invalid provider observation",
    );
  });
});
