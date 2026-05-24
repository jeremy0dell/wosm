import { runCli, runHookCommand } from "@wosm/cli";
import type { HookReceipt } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { listHookSpoolFiles } from "../../../../tests/support/spool";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";

const now = "2026-05-20T12:00:00.000Z";

describe("CLI hook command", () => {
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
    let observedPayload: unknown;

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
          }) as never,
      },
    });

    expect(result.code).toBe(0);
    expect(observedPayload).toMatchObject({
      hook_event_name: "PreToolUse",
      tool_input: {
        compacted: true,
        originalBytes: expect.any(Number),
      },
      wosm_project_id: "web",
      wosm_worktree_id: "wt_web_task",
      wosm_worktree_path: "/tmp/wosm/web/task",
      wosm_session_id: "ses_web_task",
      wosm_terminal_provider: "tmux",
      wosm_terminal_target_id: "tmux:wosm:@1:%2",
    });
    expect(JSON.stringify(observedPayload)).not.toContain("pnpm test");
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
