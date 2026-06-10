import type {
  HarnessEventReport,
  HarnessEventReportReceipt,
  ProviderHookEvent,
  ProviderHookReceipt,
} from "@wosm/contracts";
import { runProviderIngressCommand } from "@wosm/provider-hooks";
import { describe, expect, it } from "vitest";
import {
  listHookSpoolFiles,
  readHarnessEventReportSpoolRecord,
} from "../../../../tests/support/spool";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("provider hook ingress command", () => {
  it("delivers Worktrunk lifecycle hooks through observer.ingestProviderHookEvent", async () => {
    const fixture = await createTempState();
    let observedPayload: unknown;
    let observedSocketPath = "";

    const receipt = await runProviderIngressCommand(
      ["--socket", fixture.socketPath, "--state-dir", fixture.stateDir, "worktrunk", "post-create"],
      {
        stdin: JSON.stringify({ branch: "feature/run-cli" }),
      },
      {
        clock: { now: () => new Date(now) },
        hookId: () => "hook_worktrunk_1",
        clientFactory: (socketPath) => {
          observedSocketPath = socketPath;
          const ingest = async (event: ProviderHookEvent): Promise<ProviderHookReceipt> => {
            observedPayload = event.payload;
            return {
              schemaVersion: "0.4.0",
              hookId: event.hookId ?? "hook_worktrunk_1",
              provider: event.provider,
              event: event.event,
              accepted: true,
              status: "ingested",
              receivedAt: event.receivedAt,
              reconciled: false,
            };
          };
          return {
            ingestProviderHookEvent: ingest,
            ingestHookEvent: ingest,
          } as never;
        },
      },
    );

    expect(receipt).toMatchObject({
      status: "ingested",
      provider: "worktrunk",
      event: "post-create",
    });
    expect(observedSocketPath).toBe(fixture.socketPath);
    expect(observedPayload).toEqual({ branch: "feature/run-cli" });
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });

  it("delivers compact Codex payloads through observer.harnessEvent.report", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedReport: HarnessEventReport | undefined;

    const receipt = await runProviderIngressCommand(
      [
        "--socket",
        fixture.socketPath,
        "--state-dir",
        fixture.stateDir,
        "--config",
        configPath,
        "codex",
      ],
      {
        stdin: JSON.stringify(codexPayload()),
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        hookId: () => "report_codex_1",
        clientFactory: () =>
          ({
            reportHarnessEvent: async (report): Promise<HarnessEventReportReceipt> => {
              observedReport = report;
              return {
                schemaVersion: "0.4.0",
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
        cwd: "/tmp/wosm/web/task",
      },
      diagnostics: {
        compacted: true,
        omittedFieldNames: ["tool_input"],
      },
      providerData: {
        hookEventName: "PreToolUse",
        toolName: "Bash",
      },
    });
    expect(JSON.stringify(observedReport)).not.toContain("pnpm test");
  });

  it("delivers compact Cursor payloads through observer.harnessEvent.report", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedReport: HarnessEventReport | undefined;

    const receipt = await runProviderIngressCommand(
      [
        "--socket",
        fixture.socketPath,
        "--state-dir",
        fixture.stateDir,
        "--config",
        configPath,
        "cursor",
      ],
      {
        stdin: JSON.stringify(cursorPayload()),
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        hookId: () => "report_cursor_1",
        clientFactory: () =>
          ({
            reportHarnessEvent: async (report): Promise<HarnessEventReportReceipt> => {
              observedReport = report;
              return {
                schemaVersion: "0.4.0",
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
      provider: "cursor",
      eventType: "beforeShellExecution",
      correlation: {
        harnessRunId: "cursor:tmux:wosm:@1:%2",
        projectId: "web",
        worktreeId: "wt_web_task",
        sessionId: "ses_web_task",
        terminalTargetId: "tmux:wosm:@1:%2",
        nativeSessionId: "cursor_session_1",
        cwd: "/tmp/wosm/web/task",
      },
      diagnostics: {
        compacted: true,
        omittedFieldNames: ["command", "tool_input", "user_email"],
      },
      providerData: {
        hookEventName: "beforeShellExecution",
        toolName: "shell",
      },
    });
    expect(JSON.stringify(observedReport)).not.toContain("pnpm test");
    expect(JSON.stringify(observedReport)).not.toContain("person@example.com");
  });

  it("uses stable Codex report ids when no explicit hook id is provided", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedReport: HarnessEventReport | undefined;

    const receipt = await runProviderIngressCommand(
      [
        "--socket",
        fixture.socketPath,
        "--state-dir",
        fixture.stateDir,
        "--config",
        configPath,
        "codex",
      ],
      {
        stdin: JSON.stringify(codexPayload()),
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            reportHarnessEvent: async (report): Promise<HarnessEventReportReceipt> => {
              observedReport = report;
              return {
                schemaVersion: "0.4.0",
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
    expect(observedReport?.reportId).toBe(
      "codex:codex_session_1:PreToolUse:turn_1:tool%3Acall_test",
    );
  });

  it("passes the delivery timeout to the observer protocol client", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let observedTimeoutMs: number | undefined;

    const receipt = await runProviderIngressCommand(
      [
        "--socket",
        fixture.socketPath,
        "--state-dir",
        fixture.stateDir,
        "--config",
        configPath,
        "--delivery-timeout-ms",
        "4321",
        "codex",
      ],
      {
        stdin: JSON.stringify(codexPayload()),
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        hookId: () => "report_codex_timeout",
        clientFactory: (_socketPath, options) => {
          observedTimeoutMs = options.timeoutMs;
          return {
            reportHarnessEvent: async (report): Promise<HarnessEventReportReceipt> => ({
              schemaVersion: "0.4.0",
              reportId: report.reportId,
              provider: report.provider,
              eventType: report.eventType,
              accepted: true,
              status: "accepted",
              receivedAt: report.observedAt,
              projected: false,
              scheduledReconcile: true,
            }),
          } as never;
        },
      },
    );

    expect(receipt.status).toBe("ingested");
    expect(observedTimeoutMs).toBe(4321);
  });

  it("spools compact Codex reports when online delivery is unavailable", async () => {
    const fixture = await createTempState();

    const receipt = await runProviderIngressCommand(
      ["--socket", fixture.socketPath, "--state-dir", fixture.stateDir, "--no-auto-start", "codex"],
      {
        stdin: JSON.stringify(codexPayload()),
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        hookId: () => "report_codex_spooled",
        clientFactory: () =>
          ({
            reportHarnessEvent: async () => {
              throw new Error("offline");
            },
          }) as never,
      },
    );

    expect(receipt).toMatchObject({
      status: "spooled",
      provider: "codex",
      event: "PreToolUse",
    });
    const files = await listHookSpoolFiles(fixture.hookSpoolDir);
    expect(files).toHaveLength(1);
    const record = await readHarnessEventReportSpoolRecord(fixture.hookSpoolDir, files[0] ?? "");
    expect(record.report).toMatchObject({
      reportId: "report_codex_spooled",
      provider: "codex",
      eventType: "PreToolUse",
      diagnostics: {
        compacted: true,
        omittedFieldNames: ["tool_input"],
      },
    });
    expect(JSON.stringify(record)).not.toContain("pnpm test");
  });

  it("rejects malformed provider payloads before delivery or spool writes", async () => {
    const fixture = await createTempState();
    let delivered = false;

    const receipt = await runProviderIngressCommand(
      ["--socket", fixture.socketPath, "--state-dir", fixture.stateDir, "codex"],
      {
        stdin: "{ invalid json",
        env: wosmEnv(),
      },
      {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            reportHarnessEvent: async () => {
              delivered = true;
              throw new Error("should not deliver invalid payloads");
            },
          }) as never,
      },
    );

    expect(receipt).toMatchObject({
      status: "rejected",
      error: {
        code: "HOOK_PAYLOAD_INVALID",
      },
    });
    expect(delivered).toBe(false);
    await expect(listHookSpoolFiles(fixture.hookSpoolDir)).resolves.toEqual([]);
  });
});

function codexPayload() {
  return {
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
  };
}

function cursorPayload() {
  return {
    hook_event_name: "beforeShellExecution",
    session_id: "cursor_session_1",
    conversation_id: "conversation_1",
    workspace_roots: ["/tmp/wosm/web/task"],
    model: "cursor-model",
    cursor_version: "2026.06.02-8c11d9f",
    tool_name: "shell",
    command: "pnpm test",
    tool_input: { command: "pnpm test" },
    user_email: "person@example.com",
  };
}

function wosmEnv(): Record<string, string> {
  return {
    WOSM_PROJECT_ID: "web",
    WOSM_WORKTREE_ID: "wt_web_task",
    WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
    WOSM_SESSION_ID: "ses_web_task",
    WOSM_TERMINAL_PROVIDER: "tmux",
    WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
  };
}
