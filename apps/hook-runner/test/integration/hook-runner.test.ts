import type { HookReceipt } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createTempState, writeConfigToml } from "../../../../tests/support/temp-projects";
import { runHookRunner } from "../../src/index";

const now = "2026-05-20T12:00:00.000Z";

describe("wosm-hook runner", () => {
  it("exits quietly when the observer accepts a hook", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);

    const result = await runHookRunner(["--config", configPath, "worktrunk", "worktree.created"], {
      stdin: "{}",
      hookDeps: {
        clock: { now: () => new Date(now) },
        clientFactory: () =>
          ({
            ingestHookEvent: async (event): Promise<HookReceipt> => ({
              schemaVersion: "0.3.0",
              hookId: event.hookId ?? "hook_1",
              provider: event.provider,
              event: event.event,
              accepted: true,
              status: "ingested",
              receivedAt: event.receivedAt,
              reconciled: false,
            }),
          }) as never,
      },
    });

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("exits quietly when a Codex hook is ignored for missing ownership env", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let delivered = false;

    const result = await runHookRunner(["--config", configPath, "codex", "PreToolUse"], {
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

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(delivered).toBe(false);
  });

  it("prints compact stderr and exits 1 for rejected hook payloads", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);

    const result = await runHookRunner(["--config", configPath, "worktrunk", "worktree.created"], {
      stdin: "{ invalid json",
      hookDeps: {
        clock: { now: () => new Date(now) },
      },
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("HOOK_PAYLOAD_INVALID");
    expect(result.stderr).not.toContain("\n    at ");
  });

  it("passes custom config paths through observer auto-start", async () => {
    const fixture = await createTempState();
    const configPath = await writeConfigToml(fixture.root, fixture.config);
    let attempts = 0;
    let spawned = false;
    let startedConfigPath: string | undefined;

    const result = await runHookRunner(["--config", configPath, "worktrunk", "worktree.created"], {
      stdin: "{}",
      hookDeps: {
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
                throw new Error("offline before start");
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
    });

    expect(result.code).toBe(0);
    expect(startedConfigPath).toBe(configPath);
  });
});
