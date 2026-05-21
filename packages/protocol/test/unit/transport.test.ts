import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import {
  connectUnixSocket,
  isSocketStale,
  listenUnixSocket,
  removeStaleSocket,
} from "@wosm/protocol";
import { describe, expect, it } from "vitest";
import { createStaleSocketFile, createTempSocketPath } from "../../../../tests/support/sockets";

describe("Unix socket NDJSON transport", () => {
  it("exchanges newline-delimited JSON frames over a Unix socket", async () => {
    const { socketPath } = await createTempSocketPath();
    const server = await listenUnixSocket({
      socketPath,
      onConnection: async (connection) => {
        for await (const message of connection.messages()) {
          connection.send({ ok: true, echo: message });
          connection.close();
        }
      },
    });

    const client = await connectUnixSocket(socketPath);
    client.send({ hello: "world" });

    const iterator = client.messages()[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, echo: { hello: "world" } },
    });

    client.close();
    await server.close();
  });

  it("creates a user-only socket directory and removes stale socket files", async () => {
    const { socketPath } = await createTempSocketPath();
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
    await createStaleSocketFile(socketPath);

    await expect(isSocketStale(socketPath)).resolves.toBe(true);
    await expect(removeStaleSocket(socketPath)).resolves.toBe(true);

    const server = await listenUnixSocket({
      socketPath,
      onConnection: () => undefined,
    });
    const dirMode = (await stat(dirname(socketPath))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    await expect(isSocketStale(socketPath)).resolves.toBe(false);

    await server.close();
  });
});
