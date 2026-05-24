import { join } from "node:path";
import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  HookReceipt,
  ProviderHookEvent,
} from "@wosm/contracts";
import { receiveHookEvent, runHookBridgeCommand } from "@wosm/hook-bridge";
import { describe, expect, it } from "vitest";
import { listHookSpoolFiles } from "../../../../tests/support/spool";
import { createTempState } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("hook bridge command", () => {
  it("rejects malformed JSON before observer delivery or spool writes", async () => {
    const fixture = await createTempState();
    let delivered = false;
    let spooled = false;

    const receipt = await runHookBridgeCommand(
      ["worktrunk", "worktree.created"],
      {
        config: fixture.config,
        stdin: "{ invalid json",
        observerEntryPath: "/tmp/wosm-observer.js",
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async () => {
              delivered = true;
              throw new Error("should not deliver malformed hook payload");
            },
          }) as never,
        writeSpool: async () => {
          spooled = true;
          throw new Error("should not spool malformed hook payload");
        },
      },
    );

    expect(receipt).toMatchObject({
      status: "rejected",
      error: {
        code: "HOOK_PAYLOAD_INVALID",
      },
    });
    expect(delivered).toBe(false);
    expect(spooled).toBe(false);
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("keeps absent stdin payload fields absent on delivered events", async () => {
    const fixture = await createTempState();
    let deliveredEvent: ProviderHookEvent | undefined;

    const receipt = await runHookBridgeCommand(
      ["worktrunk", "worktree.created"],
      {
        config: fixture.config,
        stdin: undefined,
        observerEntryPath: "/tmp/wosm-observer.js",
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async (event): Promise<HookReceipt> => {
              deliveredEvent = event;
              return {
                schemaVersion: "0.3.0",
                hookId: event.hookId ?? "hook_1",
                provider: event.provider,
                event: event.event,
                accepted: true,
                status: "ingested",
                receivedAt: event.receivedAt,
                reconciled: false,
              };
            },
          }) as never,
      },
    );

    expect(receipt.status).toBe("ingested");
    expect(deliveredEvent).toBeDefined();
    expect(deliveredEvent).not.toHaveProperty("payload");
  });

  it("preserves Codex wosm launch context from the environment", async () => {
    const fixture = await createTempState();
    let observedReport: HarnessEventReport | undefined;

    const receipt = await runHookBridgeCommand(
      ["codex", "PreToolUse"],
      {
        config: fixture.config,
        observerEntryPath: "/tmp/wosm-observer.js",
        stdin: JSON.stringify({
          session_id: "codex_session_1",
          transcript_path: null,
          cwd: "/tmp/wosm/web/task",
          hook_event_name: "PreToolUse",
          model: "gpt-5.4-codex",
          permission_mode: "default",
          turn_id: "turn_1",
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_use_id: "call_test",
        }),
        env: {
          WOSM_PROJECT_ID: "web",
          WOSM_WORKTREE_ID: "wt_web_task",
          WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
          WOSM_SESSION_ID: "ses_web_task",
          WOSM_TERMINAL_PROVIDER: "tmux",
          WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
        },
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            reportHarnessEvent: async (report): Promise<HarnessEventReportReceipt> => {
              observedReport = report;
              return {
                schemaVersion: "0.3.0",
                reportId: report.reportId,
                provider: report.provider,
                eventType: report.eventType,
                accepted: true,
                status: "accepted",
                receivedAt: report.observedAt,
                projected: false,
                scheduledReconcile: true,
              };
            },
          }) as never,
      },
    );

    expect(receipt.status).toBe("ingested");
    expect(observedReport).toMatchObject({
      provider: "codex",
      eventType: "PreToolUse",
      correlation: {
        projectId: "web",
        worktreeId: "wt_web_task",
        sessionId: "ses_web_task",
        terminalTargetId: "tmux:wosm:@1:%2",
      },
      providerData: {
        wosmProjectId: "web",
        wosmWorktreeId: "wt_web_task",
        wosmSessionId: "ses_web_task",
      },
    });
  });

  it("passes the caller config path to hook observer auto-start", async () => {
    const fixture = await createTempState();
    const configPath = join(fixture.root, "wosm.toml");
    let attempts = 0;
    let spawned = false;
    let startedConfigPath: string | undefined;

    const receipt = await receiveHookEvent(
      {
        provider: "worktrunk",
        event: "worktree.created",
        config: fixture.config,
        configPath,
        observerEntryPath: "/tmp/wosm-observer.js",
        rateLimitMs: 0,
      },
      {
        clock: { now: () => new Date(now) },
        spawnObserver: async (input) => {
          spawned = true;
          startedConfigPath = input.configPath;
          return { pid: 1234, unref: () => undefined };
        },
        clientFactory: () =>
          ({
            health: async () => {
              if (!spawned) {
                throw new Error("stopped");
              }
              return {
                schemaVersion: "0.3.0",
                status: "healthy",
                pid: 1234,
                startedAt: now,
                version: "0.0.0",
              };
            },
            ingestHookEvent: async (event): Promise<HookReceipt> => {
              attempts += 1;
              if (attempts === 1) {
                throw new Error("offline before auto-start");
              }
              return {
                schemaVersion: "0.3.0",
                hookId: event.hookId ?? "hook_after_start",
                provider: event.provider,
                event: event.event,
                accepted: true,
                status: "ingested",
                receivedAt: event.receivedAt,
                reconciled: false,
              };
            },
          }) as never,
        sleep: async () => undefined,
      },
    );

    expect(receipt.status).toBe("ingested");
    expect(startedConfigPath).toBe(configPath);
  });
});
