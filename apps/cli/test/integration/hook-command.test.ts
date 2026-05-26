import { runCli, runHookCommand } from "@wosm/cli";
import type { HarnessEventReport, HarnessEventReportReceipt, HookReceipt } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { listHookSpoolFiles } from "../../../../tests/support/spool";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI hook command", () => {
  it("keeps legacy wosm hook usage text for missing args", async () => {
    await expect(runHookCommand([])).rejects.toThrow("Usage: wosm hook <provider> <event>");
  });

  it("forwards generic provider hook stdin payloads", async () => {
    const fixture = await createTempState();
    const receipt = await runHookCommand(
      ["worktrunk", "worktree.created"],
      {
        config: fixture.config,
        stdin: JSON.stringify({ branch: "feature/auth" }),
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async (event): Promise<HookReceipt> => ({
              schemaVersion: "0.3.0",
              hookId: "hook_1",
              provider: event.provider,
              event: event.event,
              accepted: true,
              status: "ingested",
              receivedAt: event.receivedAt,
              reconciled: true,
            }),
          }) as never,
      },
    );

    expect(receipt).toMatchObject({
      status: "ingested",
      provider: "worktrunk",
    });
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("routes runCli hook args through config-path parsing and stdin delivery", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedSocketPath = "";
    let observedPayload: unknown;

    const result = await runCli(["--config", configPath, "hook", "worktrunk", "worktree.created"], {
      stdin: JSON.stringify({ branch: "feature/run-cli" }),
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: (socketPath) => {
          observedSocketPath = socketPath;
          return {
            ingestHookEvent: async (event): Promise<HookReceipt> => {
              observedPayload = event.payload;
              return {
                schemaVersion: "0.3.0",
                hookId: "hook_1",
                provider: event.provider,
                event: event.event,
                accepted: true,
                status: "ingested",
                receivedAt: event.receivedAt,
                reconciled: true,
              };
            },
          } as never;
        },
      },
    });

    expect(result).toMatchObject({
      code: 0,
      output: {
        status: "ingested",
        provider: "worktrunk",
      },
    });
    expect(observedSocketPath).toBe(fixture.socketPath);
    expect(observedPayload).toEqual({ branch: "feature/run-cli" });
  });

  it("adds WOSM launch context to Codex hook payloads", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedReport: HarnessEventReport | undefined;

    const result = await runCli(["--config", configPath, "hook", "codex", "PreToolUse"], {
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
      hookDeps: {
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
    });

    expect(result.code).toBe(0);
    expect(observedReport).toMatchObject({
      provider: "codex",
      eventType: "PreToolUse",
      correlation: {
        projectId: "web",
        worktreeId: "wt_web_task",
        sessionId: "ses_web_task",
        terminalTargetId: "tmux:wosm:@1:%2",
        cwd: "/tmp/wosm/web/task",
      },
      diagnostics: {
        compacted: true,
        omittedFieldNames: ["tool_input"],
      },
      providerData: {
        hookEventName: "PreToolUse",
        wosmProjectId: "web",
        wosmWorktreeId: "wt_web_task",
        wosmWorktreePath: "/tmp/wosm/web/task",
        wosmSessionId: "ses_web_task",
        wosmTerminalProvider: "tmux",
        wosmTerminalTargetId: "tmux:wosm:@1:%2",
      },
    });
    expect(JSON.stringify(observedReport)).not.toContain("pnpm test");
  });

  it("exits 0 with an ignored receipt for Codex hooks without ownership env", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let delivered = false;

    const result = await runCli(["--config", configPath, "hook", "codex", "PreToolUse"], {
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
      env: {},
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            reportHarnessEvent: async () => {
              delivered = true;
              throw new Error("ignored hooks should not reach observer delivery");
            },
          }) as never,
      },
    });

    expect(result).toMatchObject({
      code: 0,
      output: {
        provider: "codex",
        event: "PreToolUse",
        accepted: false,
        status: "ignored",
      },
    });
    expect(delivered).toBe(false);
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("rejects malformed JSON stdin without delivering or spooling arbitrary text", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let delivered = false;

    const result = await runCli(["--config", configPath, "hook", "worktrunk", "worktree.created"], {
      stdin: "{ invalid json",
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async (): Promise<HookReceipt> => {
              delivered = true;
              throw new Error("should not deliver invalid hook payload");
            },
          }) as never,
      },
    });

    expect(result).toMatchObject({
      code: 1,
      output: {
        status: "rejected",
        error: {
          code: "HOOK_PAYLOAD_INVALID",
        },
      },
    });
    expect(delivered).toBe(false);
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("still rejects malformed Codex JSON when wosm hook is invoked", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let delivered = false;

    const result = await runCli(["--config", configPath, "hook", "codex", "PreToolUse"], {
      stdin: "{ invalid json",
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            reportHarnessEvent: async (): Promise<HarnessEventReportReceipt> => {
              delivered = true;
              throw new Error("should not deliver invalid hook payload");
            },
          }) as never,
      },
    });

    expect(result).toMatchObject({
      code: 1,
      output: {
        status: "rejected",
        error: {
          code: "HOOK_PAYLOAD_INVALID",
        },
      },
    });
    expect(delivered).toBe(false);
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("returns exit code 1 when the hook receiver returns a rejected receipt", async () => {
    const fixture = await createTempState();
    const config = {
      ...fixture.config,
      observer: {
        ...fixture.config.observer,
        autoStartFromHooks: false,
      },
    };
    const configPath = await writeConfigToml(fixture.root, config);

    const result = await runCli(["--config", configPath, "hook", "worktrunk", "worktree.created"], {
      stdin: "{}",
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async () => {
              throw new Error("offline");
            },
          }) as never,
        writeSpool: async ({ event }) => ({
          schemaVersion: "0.3.0",
          hookId: "hook_rejected",
          provider: event.provider,
          event: event.event,
          accepted: false,
          status: "rejected",
          receivedAt: event.receivedAt,
          error: {
            tag: "HookSpoolError",
            code: "HOOK_SPOOL_REJECTED",
            message: "Hook spool rejected the record safely.",
          },
        }),
      },
    });

    expect(result).toMatchObject({
      code: 1,
      output: {
        status: "rejected",
        error: {
          code: "HOOK_SPOOL_REJECTED",
        },
      },
    });
  });
});
