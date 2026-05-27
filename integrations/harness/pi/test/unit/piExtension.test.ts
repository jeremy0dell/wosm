import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compactPiExtensionEvent,
  type PiExtensionDeps,
  registerWosmPiExtension,
} from "../../src/piExtension";

describe("wosm Pi extension", () => {
  it("keeps the extension runtime dependency-light", async () => {
    const source = await readFile(new URL("../../src/piExtension.ts", import.meta.url), "utf8");

    expect(source).toContain('from "./eventNames.js"');
    expect(source).not.toContain('from "./events.js"');
  });

  it("registers only approved low-cardinality Pi events", () => {
    const handlers = new Map<string, (event: unknown, context: unknown) => Promise<void>>();

    registerWosmPiExtension({
      on: (event, handler) => {
        handlers.set(event, handler);
      },
    });

    expect([...handlers.keys()]).toEqual([
      "session_start",
      "session_shutdown",
      "agent_start",
      "agent_end",
      "turn_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_end",
      "session_compact",
    ]);
    expect(handlers.has("message_update")).toBe(false);
    expect(handlers.has("tool_execution_update")).toBe(false);
    expect(handlers.has("tool_call")).toBe(false);
    expect(handlers.has("input")).toBe(false);
    expect(handlers.has("user_bash")).toBe(false);
    expect(handlers.has("before_agent_start")).toBe(false);
  });

  it("emits compact payloads through wosm-hook command delivery", async () => {
    const delivered: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const handlers = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
    const deps: PiExtensionDeps = {
      env: env(),
      pid: 4321,
      runHookCommand: async (input) => {
        delivered.push(input);
      },
    };

    registerWosmPiExtension(
      {
        on: (event, handler) => {
          handlers.set(event, handler);
        },
      },
      deps,
    );
    await handlers.get("tool_execution_start")?.(
      {
        toolCallId: "toolu_1",
        toolName: "bash",
        args: {
          command: "echo raw command body",
        },
      },
      context(),
    );

    expect(delivered).toEqual([
      {
        eventType: "tool_execution_start",
        payload: expect.objectContaining({
          event_type: "tool_execution_start",
          cwd: "/tmp/wosm/web/task",
          pid: 4321,
          tool_call_id: "toolu_1",
          tool_name: "bash",
          pi_session_id: "session",
          pi_session_file: "/tmp/pi/session.jsonl",
          wosm_project_id: "web",
          wosm_worktree_id: "wt_web_task",
          wosm_session_id: "ses_web_task",
          wosm_terminal_target_id: "tmux:wosm:@1:%2",
        }),
      },
    ]);
    expect(JSON.stringify(delivered)).not.toContain("raw command body");
  });

  it("spawns wosm-hook with config, provider event name, and JSON stdin by default", async () => {
    const handlers = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
    const spawns: Array<{ command: string; args: string[] }> = [];
    const stdin: string[] = [];
    const deps: PiExtensionDeps = {
      env: env(),
      pid: 4321,
      spawnHookCommand: (command, args) => {
        spawns.push({ command, args });
        const child = new EventEmitter() as EventEmitter & {
          kill(): void;
          stdin: {
            end(input: string): void;
          };
        };
        child.kill = () => undefined;
        child.stdin = {
          end: (input: string) => {
            stdin.push(input);
            queueMicrotask(() => child.emit("close", 0));
          },
        };
        return child;
      },
    };

    registerWosmPiExtension(
      {
        on: (event, handler) => {
          handlers.set(event, handler);
        },
      },
      deps,
    );
    await handlers.get("session_start")?.({ reason: "startup" }, context());

    expect(spawns).toEqual([
      {
        command: "wosm-hook",
        args: ["--config", "/tmp/wosm/config.toml", "pi", "session_start"],
      },
    ]);
    expect(JSON.parse(stdin[0] ?? "{}")).toMatchObject({
      event_type: "session_start",
      cwd: "/tmp/wosm/web/task",
      wosm_session_id: "ses_web_task",
    });
  });

  it("omits prompts, message bodies, tool results, and system prompts", () => {
    const rawSecret = "secret raw body";
    const payload = compactPiExtensionEvent(
      "message_end",
      {
        prompt: rawSecret,
        systemPrompt: rawSecret,
        message: {
          role: "assistant",
          content: rawSecret,
        },
        result: rawSecret,
      },
      context(),
      {
        env: env(),
        pid: 4321,
      },
    );

    expect(payload).toMatchObject({
      event_type: "message_end",
      message_role: "assistant",
      cwd: "/tmp/wosm/web/task",
    });
    expect(JSON.stringify(payload)).not.toContain(rawSecret);
  });
});

function env(): Record<string, string> {
  return {
    WOSM_PROJECT_ID: "web",
    WOSM_WORKTREE_ID: "wt_web_task",
    WOSM_WORKTREE_PATH: "/tmp/wosm/web/task",
    WOSM_SESSION_ID: "ses_web_task",
    WOSM_TERMINAL_PROVIDER: "tmux",
    WOSM_TERMINAL_TARGET_ID: "tmux:wosm:@1:%2",
    WOSM_CONFIG_PATH: "/tmp/wosm/config.toml",
  };
}

function context() {
  return {
    cwd: "/tmp/wosm/web/task",
    model: {
      provider: "openai",
      id: "gpt-5.4",
      apiKey: "not copied",
    },
    sessionManager: {
      getSessionFile: () => "/tmp/pi/session.jsonl",
    },
  };
}
