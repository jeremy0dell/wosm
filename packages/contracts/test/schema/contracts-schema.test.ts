import { readFile } from "node:fs/promises";
import {
  CommandRecordSchema,
  createClientFeatureFlagsSchema,
  createEvaluatedFeatureFlagsSchema,
  createFeatureFlagConfigSchema,
  ErrorEnvelopeSchema,
  EventFilterSchema,
  FeatureFlagConfigSchema,
  type FeatureFlagDefinitionsMap,
  HarnessCapabilitiesSchema,
  HarnessEventObservationSchema,
  HarnessEventReportReceiptSchema,
  HarnessEventReportSchema,
  HarnessEventReportSpoolRecordSchema,
  HarnessLaunchPlanSchema,
  HarnessRunObservationSchema,
  HarnessStatusObservationSchema,
  HookReceiptSchema,
  HookSpoolRecordSchema,
  ObservedStatusSchema,
  ObserverHealthSchema,
  ObserverStopReceiptSchema,
  type ProjectId,
  ProjectIdSchema,
  ProviderHealthSchema,
  ProviderHookEventSchema,
  ProviderProjectConfigSchema,
  ProviderTypeSchema,
  parseWosmHookIdentityPayload,
  ReconcileReceiptSchema,
  RepositoryCapabilitiesSchema,
  RepositoryChecksRequestSchema,
  RepositoryPullRequestRequestSchema,
  RepositoryRemoteSchema,
  SafeErrorSchema,
  TerminalCapabilitiesSchema,
  TerminalHarnessBindingProviderDataSchema,
  TerminalIdentityBindingSchema,
  TerminalTargetObservationSchema,
  WOSM_SCHEMA_VERSION,
  WorktreeCapabilitiesSchema,
  WorktreeChecksStateSchema,
  type WorktreeId,
  WorktreeObservationSchema,
  WosmCommandSchema,
  WosmEventSchema,
  WosmHookIdentityPayloadSchema,
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

    expectParses(
      WosmSnapshotSchema,
      {
        ...(snapshots.multipleProjects as Record<string, unknown>),
        harnesses: [
          { id: "codex", label: "codex" },
          { id: "opencode", label: "opencode" },
        ],
      },
      "snapshot with configured harness options",
    );

    expectFails(
      WosmSnapshotSchema,
      await loadJson("snapshots/invalid-snapshot.json"),
      "invalid snapshot fixture",
    );
    expectFails(
      WosmSnapshotSchema,
      {
        ...(snapshots.orphanedTerminalTarget as Record<string, unknown>),
        orphans: [
          {
            id: "orphan_term_secret",
            kind: "terminal_target",
            provider: "tmux",
            terminalTargetId: "term_orphan_agent",
            reason: "Terminal target has no matching configured project or worktree.",
            observedAt: "2026-05-20T12:00:00.000Z",
            providerData: {
              secret: "do-not-expose",
            },
          },
        ],
      },
      "orphan provider data boundary",
    );
  });

  it("keeps production feature flags empty until a real flag is registered", () => {
    expect(FeatureFlagConfigSchema.parse({})).toEqual({});
    expect(FeatureFlagConfigSchema.safeParse({ "test.fake": true }).success).toBe(false);

    expect(
      WosmSnapshotSchema.parse({
        schemaVersion: WOSM_SCHEMA_VERSION,
        generatedAt: "2026-05-20T12:00:00.000Z",
        observer: {
          pid: 1234,
          startedAt: "2026-05-20T11:59:00.000Z",
          version: "0.0.0",
          healthy: true,
        },
        providerHealth: {},
        projects: [],
        rows: [],
        sessions: [],
        counts: {
          projects: 0,
          worktrees: 0,
          agents: 0,
          working: 0,
          idle: 0,
          attention: 0,
          unknown: 0,
        },
        alerts: [],
        featureFlags: {
          revision: "test",
          flags: {},
        },
      }),
    ).toMatchObject({
      featureFlags: {
        revision: "test",
        flags: {},
      },
    });
  });

  it("supports test-local feature flag registries without adding fake production flags", () => {
    const definitions = {
      "test.clientFlag": {
        defaultValue: false,
        exposure: "client",
        owner: "tui",
        surfaces: ["tui"],
        lifecycle: "temporary",
        summary: "Test-only client flag.",
      },
      "test.serverFlag": {
        defaultValue: true,
        exposure: "server",
        owner: "observer",
        surfaces: ["observer"],
        lifecycle: "temporary",
        summary: "Test-only server flag.",
      },
    } as const satisfies FeatureFlagDefinitionsMap;

    expect(
      createFeatureFlagConfigSchema(definitions).parse({
        "test.clientFlag": true,
      }),
    ).toEqual({
      "test.clientFlag": true,
    });
    expect(
      createFeatureFlagConfigSchema(definitions).safeParse({
        "test.unknown": true,
      }).success,
    ).toBe(false);
    expect(
      createEvaluatedFeatureFlagsSchema(definitions).parse({
        revision: "test",
        flags: {
          "test.clientFlag": true,
          "test.serverFlag": false,
        },
      }),
    ).toMatchObject({
      flags: {
        "test.clientFlag": true,
        "test.serverFlag": false,
      },
    });
    expect(
      createEvaluatedFeatureFlagsSchema(definitions).safeParse({
        revision: "test",
        flags: {
          "test.clientFlag": true,
        },
      }).success,
    ).toBe(false);
    expect(
      createClientFeatureFlagsSchema(definitions).safeParse({
        revision: "test",
        flags: {
          "test.serverFlag": false,
        },
      }).success,
    ).toBe(false);
    expect(
      createClientFeatureFlagsSchema(definitions).safeParse({
        revision: "test",
        flags: {},
      }).success,
    ).toBe(false);
  });

  it("parses normalized branch metadata and rejects raw provider metadata shapes", () => {
    const checkedAt = "2026-05-20T12:00:00.000Z";
    const normalizedObservation = {
      id: "wt_web_feature_auth",
      provider: "worktrunk",
      projectId: "web",
      branch: "feature/auth",
      path: "/tmp/wosm-fixtures/web/worktrees/feature-auth",
      state: "exists",
      source: "worktrunk",
      dirty: false,
      pr: {
        number: 42,
        url: "https://github.com/example/web/pull/42",
        host: "github",
        state: "open",
        baseRef: "main",
        headRef: "feature/auth",
        updatedAt: checkedAt,
        checkedAt,
        stale: false,
      },
      changeSummary: {
        kind: "branch_diff",
        additions: 12,
        deletions: 3,
        filesChanged: 4,
        binaryFiles: 1,
        baseRef: "main",
        baseSha: "1234567890abcdef1234567890abcdef12345678",
        headRef: "feature/auth",
        headSha: "abcdef1234567890abcdef1234567890abcdef12",
        source: "local_git",
        checkedAt,
      },
      checks: {
        state: "pass",
        url: "https://github.com/example/web/actions/runs/1",
        total: 5,
        passed: 5,
        failed: 0,
        pending: 0,
        source: "github",
        checkedAt,
      },
      confidence: "high",
      reason: "Provider listed the worktree.",
      observedAt: checkedAt,
    };

    expectParses(WorktreeObservationSchema, normalizedObservation, "metadata observation");

    const parsedWithoutMetadata = WorktreeObservationSchema.parse({
      id: "wt_web_no_metadata",
      provider: "worktrunk",
      projectId: "web",
      branch: "no-metadata",
      path: "/tmp/wosm-fixtures/web/worktrees/no-metadata",
      state: "exists",
      source: "worktrunk",
      observedAt: checkedAt,
    });
    expect(parsedWithoutMetadata).not.toHaveProperty("pr");
    expect(parsedWithoutMetadata).not.toHaveProperty("changeSummary");
    expect(parsedWithoutMetadata).not.toHaveProperty("checks");

    const row = {
      id: "wt_web_feature_auth",
      projectId: "web",
      projectLabel: "web",
      branch: "feature/auth",
      path: "/tmp/wosm-fixtures/web/worktrees/feature-auth",
      worktree: {
        state: "exists",
        source: "worktrunk",
        dirty: false,
        pr: normalizedObservation.pr,
        changeSummary: normalizedObservation.changeSummary,
        checks: normalizedObservation.checks,
      },
      display: {
        statusLabel: "no agent",
        sortPriority: 70,
        alert: false,
      },
    };
    const snapshot = {
      schemaVersion: WOSM_SCHEMA_VERSION,
      generatedAt: checkedAt,
      observer: {
        pid: 4242,
        startedAt: "2026-05-20T11:55:00.000Z",
        version: "0.0.0",
        healthy: true,
      },
      providerHealth: {},
      projects: [],
      rows: [row],
      sessions: [],
      counts: {
        projects: 0,
        worktrees: 1,
        agents: 0,
        working: 0,
        idle: 0,
        attention: 0,
        unknown: 0,
      },
      alerts: [],
    };

    expectParses(WosmSnapshotSchema, snapshot, "snapshot with normalized branch metadata");
    expectFails(
      WosmSnapshotSchema,
      {
        ...snapshot,
        rows: [
          {
            ...row,
            worktree: {
              ...row.worktree,
              pr: {
                number: 42,
                html_url: "https://github.com/example/web/pull/42",
                state: "open",
              },
            },
          },
        ],
      },
      "snapshot with raw GitHub PR payload",
    );
    expectFails(
      WosmSnapshotSchema,
      {
        ...snapshot,
        rows: [
          {
            ...row,
            worktree: {
              ...row.worktree,
              checks: {
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/example/web/actions/runs/1",
              },
            },
          },
        ],
      },
      "snapshot with raw CI checks payload",
    );
    expectFails(
      WosmSnapshotSchema,
      {
        ...snapshot,
        rows: [
          {
            ...row,
            worktree: {
              ...row.worktree,
              changeSummary: {
                ...normalizedObservation.changeSummary,
                binaryFiles: -1,
              },
            },
          },
        ],
      },
      "snapshot with invalid binary file count",
    );
    expectFails(
      WosmSnapshotSchema,
      {
        ...snapshot,
        rows: [
          {
            ...row,
            worktree: {
              ...row.worktree,
              changeSummary: {
                ...normalizedObservation.changeSummary,
                headSha: "",
              },
            },
          },
        ],
      },
      "snapshot with invalid head sha",
    );
  });

  it("parses provider-neutral repository contracts", () => {
    expect(ProviderTypeSchema.parse("repository")).toBe("repository");
    expectFails(ProviderTypeSchema, "code_host", "legacy code host provider type");

    expectParses(
      RepositoryCapabilitiesSchema,
      {
        canDiscoverPullRequests: true,
        canReadChecks: true,
        canUseCliAuth: true,
      },
      "repository capabilities",
    );
    expectParses(
      RepositoryRemoteSchema,
      {
        host: "github.com",
        owner: "example",
        repo: "web",
        url: "git@github.com:example/web.git",
      },
      "repository remote",
    );
    expectParses(
      RepositoryPullRequestRequestSchema,
      {
        remote: {
          host: "github.com",
          owner: "example",
          repo: "web",
        },
        branch: "feature/auth",
        headSha: "abcdef1234567890abcdef1234567890abcdef12",
        projectId: "web",
        worktreeId: "wt_web_feature_auth",
      },
      "repository PR request",
    );
    expectParses(
      RepositoryChecksRequestSchema,
      {
        remote: {
          host: "github.com",
          owner: "example",
          repo: "web",
        },
        pullRequestNumber: 42,
        branch: "feature/auth",
      },
      "repository checks request",
    );
    expect(WorktreeChecksStateSchema.parse("skipped")).toBe("skipped");
    expect(WorktreeChecksStateSchema.parse("cancelled")).toBe("cancelled");
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
      "terminal.close",
      "terminal.focus",
      "worktree.create",
      "worktree.remove",
    ]);

    expectFails(
      WosmCommandSchema,
      await loadJson("commands/invalid-command.json"),
      "invalid command fixture",
    );

    expectParses(
      WosmCommandSchema,
      {
        type: "terminal.focus",
        payload: {
          targetId: "tmux:wosm:@1:%2",
          origin: {
            provider: "tmux",
            clientId: "client_1",
          },
        },
      },
      "terminal focus command with popup focus origin",
    );

    expectParses(
      WosmCommandSchema,
      {
        type: "session.startAgent",
        payload: {
          projectId: "web",
          worktreeId: "wt_web_feature",
        },
      },
      "start agent command with remembered harness",
    );

    expectFails(
      WosmCommandSchema,
      {
        type: "terminal.focus",
        payload: {
          targetId: "tmux:wosm:@1:%2",
          origin: {
            provider: "tmux",
            clientId: "client_1",
            tmuxSession: "wosm",
          },
        },
      },
      "terminal focus origin with provider-specific extra fields",
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
      "harness.eventReported",
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
      WosmHookIdentityPayloadSchema,
      {
        wosm_session_id: "ses_web_task",
        wosm_worktree_id: "wt_web_task",
        extra_provider_field: "kept",
      },
      "wosm hook identity payload",
    );
    expect(parseWosmHookIdentityPayload(null)).toBeUndefined();

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
      HookReceiptSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        hookId: "hook_ignored_1",
        provider: "codex",
        event: "PreToolUse",
        accepted: false,
        status: "ignored",
        receivedAt: "2026-05-20T12:02:00.000Z",
      },
      "ignored hook receipt",
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

    const harnessReport = {
      schemaVersion: WOSM_SCHEMA_VERSION,
      reportId: "report_1",
      provider: "codex",
      kind: "harness",
      eventType: "PreToolUse",
      observedAt: "2026-05-20T12:02:00.000Z",
      coalesceKey: "turn:turn_1:tool:Bash",
      status: {
        value: "working",
        confidence: "medium",
        reason: "Codex is about to use Bash.",
        source: "harness_hook",
        updatedAt: "2026-05-20T12:02:00.000Z",
      },
      correlation: {
        sessionId: "ses_web_task",
        worktreeId: "wt_web_task",
        terminalTargetId: "tmux:wosm:@1:%2",
        projectId: "web",
        cwd: "/tmp/wosm/web/task",
      },
      diagnostics: {
        rawEventType: "PreToolUse",
        payloadBytes: 400,
        compactedBytes: 180,
        compacted: true,
        truncated: false,
        omittedFieldNames: ["tool_input"],
      },
      providerData: {
        hookEventName: "PreToolUse",
      },
    };

    expectParses(HarnessEventReportSchema, harnessReport, "harness event report");
    expectParses(
      ObservedStatusSchema,
      {
        value: "working",
        confidence: "medium",
        reason: "Harness event source accepted.",
        source: "harness_event",
        updatedAt: "2026-05-20T12:02:00.000Z",
      },
      "harness event status source",
    );
    expectParses(
      TerminalHarnessBindingProviderDataSchema,
      {
        sessionId: "wosm",
        windowId: "@1",
        paneId: "%2",
        role: "main-agent",
        harness: "codex",
        currentCommand: "codex",
        worktreePath: "/tmp/wosm/web/task",
      },
      "terminal harness binding provider data",
    );
    expectFails(
      TerminalHarnessBindingProviderDataSchema,
      {
        sessionId: "wosm",
        windowId: "@1",
        paneId: "%2",
        role: "main-agent",
        harness: "codex",
        currentCommand: "codex",
        worktreePath: "/tmp/wosm/web/task",
        providerSpecificLeak: "not allowed",
      },
      "terminal harness binding rejects extra provider data",
    );
    expectFails(
      HarnessEventReportSchema,
      {
        ...harnessReport,
        status: {
          ...(harnessReport.status as Record<string, unknown>),
          reason: undefined,
        },
      },
      "harness event report with explicit undefined",
    );

    expectParses(
      HarnessEventReportReceiptSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        reportId: "report_1",
        provider: "codex",
        eventType: "PreToolUse",
        accepted: true,
        status: "accepted",
        receivedAt: "2026-05-20T12:02:00.000Z",
        projected: false,
        scheduledReconcile: true,
      },
      "harness event report receipt",
    );

    expectParses(
      HarnessEventReportSpoolRecordSchema,
      {
        schemaVersion: WOSM_SCHEMA_VERSION,
        spoolId: "spool_report_1",
        createdAt: "2026-05-20T12:02:01.000Z",
        report: harnessReport,
        attempts: 0,
      },
      "harness event report spool record",
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
        harnessIngressQueue: {
          depth: 0,
          enqueued: 10,
          processed: 8,
          coalesced: 2,
          dropped: 0,
          failed: 0,
          lastProcessedAt: "2026-05-20T12:00:01.000Z",
          lastDrain: {
            scanned: 2,
            drained: 2,
            failed: 0,
            finishedAt: "2026-05-20T12:00:02.000Z",
          },
        },
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
