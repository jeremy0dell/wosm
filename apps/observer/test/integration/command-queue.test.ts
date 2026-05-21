import type { WosmCommand } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import { createCommandQueue } from "../../src/commandQueue";
import { createObserverPersistence } from "../../src/persistence";
import { openObserverSqlite } from "../../src/sqlite";

const now = "2026-05-20T12:00:00.000Z";

function commandIds() {
  let command = 0;
  let event = 0;
  let error = 0;
  return {
    commandId: () => {
      command += 1;
      return `cmd_${command}`;
    },
    eventId: () => {
      event += 1;
      return `evt_${event}`;
    },
    errorId: () => {
      error += 1;
      return `err_${error}`;
    },
  };
}

function createPersistenceAndQueue() {
  const ids = commandIds();
  const sqlite = openObserverSqlite({ clock: { now: () => new Date(now) } });
  const persistence = createObserverPersistence({
    sqlite,
    clock: { now: () => new Date(now) },
    idFactory: ids,
  });
  const queue = createCommandQueue({
    persistence,
    clock: { now: () => new Date(now) },
    idFactory: ids,
  });
  return { sqlite, persistence, queue };
}

const reconcileCommand: WosmCommand = {
  type: "observer.reconcile",
  payload: {
    reason: "queue-test",
  },
};

const sendPromptCommand: WosmCommand = {
  type: "session.sendPrompt",
  payload: {
    sessionId: "ses_web_main",
    prompt: "Summarize current status.",
  },
};

describe("observer command queue", () => {
  it("records accepted, started, and succeeded lifecycle events", async () => {
    const { sqlite, persistence, queue } = createPersistenceAndQueue();
    const handled: string[] = [];
    queue.registerHandler("observer.reconcile", async ({ commandId }) => {
      handled.push(commandId);
    });

    const receipt = await queue.dispatch(reconcileCommand);
    await queue.drain();

    expect(receipt).toEqual({
      commandId: "cmd_1",
      traceId: expect.stringMatching(/^trc_/),
      spanId: expect.stringMatching(/^spn_/),
      accepted: true,
      status: "accepted",
    });
    expect(handled).toEqual(["cmd_1"]);
    expect(await persistence.listCommands()).toEqual([
      expect.objectContaining({
        id: "cmd_1",
        status: "succeeded",
        traceId: receipt.traceId,
        spanId: receipt.spanId,
      }),
    ]);
    const events = await persistence.listEvents({ commandId: "cmd_1" });
    expect(events.map((event) => event.type)).toEqual([
      "command.accepted",
      "command.started",
      "command.succeeded",
    ]);
    expect(events.map((event) => event.traceId)).toEqual([
      receipt.traceId,
      receipt.traceId,
      receipt.traceId,
    ]);
    sqlite.close();
  });

  it("records failed commands with SafeError and internal envelope records", async () => {
    const { sqlite, persistence, queue } = createPersistenceAndQueue();
    queue.registerHandler("observer.reconcile", async () => {
      throw new Error("raw provider stack detail");
    });

    await queue.dispatch(reconcileCommand);
    await queue.drain();

    expect(await persistence.listCommands()).toEqual([
      expect.objectContaining({
        id: "cmd_1",
        status: "failed",
        error: expect.objectContaining({
          tag: "CommandExecutionError",
          code: "COMMAND_EXECUTION_FAILED",
          commandId: "cmd_1",
        }),
      }),
    ]);
    expect(JSON.stringify((await persistence.listCommands())[0]?.error)).not.toContain(
      "raw provider",
    );
    expect(await persistence.listCommandErrors("cmd_1")).toEqual([
      expect.objectContaining({
        commandId: "cmd_1",
        envelope: expect.objectContaining({
          id: "err_1",
          tag: "CommandExecutionError",
        }),
      }),
    ]);
    expect(
      (await persistence.listEvents({ commandId: "cmd_1" })).map((event) => event.type),
    ).toEqual(["command.accepted", "command.started", "command.failed"]);
    sqlite.close();
  });

  it("serializes command execution by session scope", async () => {
    const { sqlite, queue } = createPersistenceAndQueue();
    const starts: string[] = [];
    const finishes: string[] = [];
    let releaseFirst = () => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    queue.registerHandler("session.sendPrompt", async ({ commandId }) => {
      starts.push(commandId);
      if (commandId === "cmd_1") {
        await firstBlocked;
      }
      finishes.push(commandId);
    });

    const first = queue.dispatch(sendPromptCommand);
    const second = queue.dispatch(sendPromptCommand);
    await Promise.all([first, second]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(starts).toEqual(["cmd_1"]);

    releaseFirst();
    await queue.drain();

    expect(starts).toEqual(["cmd_1", "cmd_2"]);
    expect(finishes).toEqual(["cmd_1", "cmd_2"]);
    sqlite.close();
  });
});
