import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { runRuntimeBoundary, runRuntimeBoundaryWithTimeout } from "@wosm/runtime";
import { protocolSafeError } from "./messages.js";

export type NdjsonConnection = {
  send(value: unknown): void;
  messages(): AsyncIterable<unknown>;
  close(): void;
  readonly closed: Promise<void>;
};

export type ListenUnixSocketOptions = {
  socketPath: string;
  onConnection(connection: NdjsonConnection): void | Promise<void>;
};

export type UnixSocketServer = {
  readonly socketPath: string;
  close(): Promise<void>;
};

export type ConnectUnixSocketOptions = {
  timeoutMs?: number;
};

export async function ensureSocketDirectory(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(socketPath), 0o700);
}

export async function isSocketStale(socketPath: string): Promise<boolean> {
  try {
    const stats = await lstat(socketPath);
    if (!stats.isSocket()) {
      return true;
    }
  } catch {
    return false;
  }

  try {
    const connection = await connectUnixSocket(socketPath, { timeoutMs: 100 });
    connection.close();
    return false;
  } catch {
    return true;
  }
}

export async function removeStaleSocket(socketPath: string): Promise<boolean> {
  if (!(await isSocketStale(socketPath))) {
    return false;
  }
  await unlink(socketPath);
  return true;
}

export async function listenUnixSocket(
  options: ListenUnixSocketOptions,
): Promise<UnixSocketServer> {
  await ensureSocketDirectory(options.socketPath);
  await removeStaleSocket(options.socketPath);

  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    const connection = ndjsonConnection(socket);
    void options.onConnection(connection);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.socketPath);
  });

  try {
    await chmod(options.socketPath, 0o600);
  } catch {
    // Some platforms do not allow chmod on socket files; the parent dir is still 0700.
  }

  return {
    socketPath: options.socketPath,
    close: () => closeServer(server, options.socketPath, sockets),
  };
}

export function connectUnixSocket(
  socketPath: string,
  options: ConnectUnixSocketOptions = {},
): Promise<NdjsonConnection> {
  const task = ({ signal }: { signal: AbortSignal }) => connectUnixSocketOnce(socketPath, signal);
  if (options.timeoutMs === undefined) {
    return runRuntimeBoundary(
      {
        operation: "protocol.socket.connect",
        error: protocolSafeError({
          code: "PROTOCOL_CONNECT_FAILED",
          message: `Could not connect to observer socket ${socketPath}.`,
        }),
      },
      task,
    ).then((result) => {
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    });
  }

  return runRuntimeBoundaryWithTimeout(
    {
      operation: "protocol.socket.connect",
      timeoutMs: options.timeoutMs,
      error: protocolSafeError({
        code: "PROTOCOL_CONNECT_FAILED",
        message: `Could not connect to observer socket ${socketPath}.`,
      }),
      timeoutError: protocolSafeError({
        tag: "TimeoutError",
        code: "PROTOCOL_CONNECT_TIMEOUT",
        message: `Timed out connecting to observer socket ${socketPath}.`,
      }),
    },
    task,
  ).then((result) => {
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  });
}

function connectUnixSocketOnce(socketPath: string, signal: AbortSignal): Promise<NdjsonConnection> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      socket.destroy();
      settle(() =>
        reject(
          protocolSafeError({
            tag: "TimeoutError",
            code: "PROTOCOL_CONNECT_TIMEOUT",
            message: `Timed out connecting to observer socket ${socketPath}.`,
          }),
        ),
      );
    };
    const onConnect = () => {
      settle(() => resolve(ndjsonConnection(socket)));
    };
    const onError = (error: Error) => {
      settle(() => reject(error));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function ndjsonConnection(socket: Socket): NdjsonConnection {
  socket.setEncoding("utf8");
  let buffer = "";
  let closedResolve: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  const messages: unknown[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let streamError: Error | undefined;

  // Socket data is push-based, while callers consume a pull-based AsyncIterable.
  // Parsed frames queue in messages; waiters wake consumers blocked on next().
  const wake = () => {
    while (waiters.length > 0) {
      waiters.shift()?.();
    }
  };

  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim().length === 0) {
        continue;
      }
      try {
        messages.push(JSON.parse(line));
      } catch (error) {
        // A malformed frame poisons the stream so the generator surfaces the parse error.
        streamError = error instanceof Error ? error : new Error("Invalid NDJSON frame.");
        socket.destroy(streamError);
      }
    }
    wake();
  });

  socket.on("error", (error) => {
    streamError = error;
    done = true;
    wake();
    closedResolve();
  });
  socket.on("close", () => {
    done = true;
    wake();
    closedResolve();
  });

  return {
    send: (value) => {
      socket.write(`${JSON.stringify(value)}\n`);
    },
    messages: async function* () {
      for (;;) {
        if (messages.length > 0) {
          yield messages.shift();
          continue;
        }
        if (streamError !== undefined) {
          throw streamError;
        }
        if (done) {
          return;
        }
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
    },
    close: () => {
      socket.end();
      socket.destroySoon();
    },
    closed,
  };
}

async function closeServer(
  server: Server,
  socketPath: string,
  sockets: Set<Socket>,
): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  for (const socket of sockets) {
    socket.end();
    socket.destroySoon();
  }
  await closed;
  try {
    await removeStaleSocket(socketPath);
  } catch {
    // The socket may already be gone after process teardown.
  }
}
