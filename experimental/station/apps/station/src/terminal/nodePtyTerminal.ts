import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  StationTerminalDisposable,
  StationTerminalExit,
  StationTerminalProcess,
  StationTerminalSize,
  StationTerminalSpawnOptions,
} from "./types.js";
import { StationTerminalSpawnError } from "./errors.js";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const BRIDGE_PATH = fileURLToPath(new URL("./nodePtyBridge.cjs", import.meta.url));
let nextTerminalSequence = 0;

type BridgeMessage =
  | {
      type: "ready";
      pid: number;
    }
  | {
      type: "data";
      data: string;
    }
  | {
      type: "exit";
      exitCode: number;
      signal?: number;
    };

export function createNodePtyTerminal(
  options: StationTerminalSpawnOptions = {},
): StationTerminalProcess {
  const size = normalizeSize(options.size);
  const env = createPtyEnv(options.env);
  const command = options.command ?? defaultShell();
  const args = options.args === undefined ? defaultShellArgs() : [...options.args];
  const bridgeOptions = {
    args,
    cols: size.cols,
    command,
    cwd: options.cwd ?? process.cwd(),
    env,
    name: options.name ?? env.TERM ?? "xterm-256color",
    rows: size.rows,
  };

  try {
    const bridge = spawn(resolveNodeCommand(), [
      BRIDGE_PATH,
      Buffer.from(JSON.stringify(bridgeOptions), "utf8").toString("base64url"),
    ]);

    return new NodePtyTerminalProcess(
      options.id ?? createTerminalId(),
      command,
      size,
      bridge,
    );
  } catch (error) {
    throw new StationTerminalSpawnError(command, error);
  }
}

class NodePtyTerminalProcess implements StationTerminalProcess {
  readonly id: string;
  readonly command: string;

  #bridge: ChildProcessWithoutNullStreams;
  #dataListeners = new Set<(data: string) => void>();
  #exitListeners = new Set<(event: StationTerminalExit) => void>();
  #pendingData: string[] = [];
  #stdoutBuffer = "";
  #disposed = false;
  #exited = false;
  #pid: number;
  #size: StationTerminalSize;

  constructor(
    id: string,
    command: string,
    size: StationTerminalSize,
    bridge: ChildProcessWithoutNullStreams,
  ) {
    this.id = id;
    this.command = command;
    this.#size = size;
    this.#bridge = bridge;
    this.#pid = bridge.pid ?? 0;

    bridge.stdout.setEncoding("utf8");
    bridge.stdout.on("data", (chunk: string) => {
      this.handleBridgeOutput(chunk);
    });
    bridge.stderr.setEncoding("utf8");
    bridge.stderr.on("data", (chunk: string) => {
      this.emitData(chunk);
    });
    bridge.on("error", (error) => {
      this.emitExit({
        exitCode: 1,
      });
      this.emitData(error.message);
    });
    bridge.on("exit", (code, signal) => {
      if (this.#exited) {
        return;
      }

      const event: StationTerminalExit = {
        exitCode: code ?? 0,
      };
      if (signal !== null) {
        event.signal = signalToNumber(signal);
      }
      this.emitExit(event);
    });
  }

  get pid(): number {
    return this.#pid;
  }

  get size(): StationTerminalSize {
    return this.#size;
  }

  onData(listener: (data: string) => void): StationTerminalDisposable {
    this.assertActive("subscribe to terminal data");
    this.#dataListeners.add(listener);
    for (const data of this.#pendingData) {
      listener(data);
    }
    this.#pendingData = [];
    return {
      dispose: () => {
        this.#dataListeners.delete(listener);
      },
    };
  }

  onExit(listener: (event: StationTerminalExit) => void): StationTerminalDisposable {
    this.assertActive("subscribe to terminal exit");
    this.#exitListeners.add(listener);
    return {
      dispose: () => {
        this.#exitListeners.delete(listener);
      },
    };
  }

  write(data: string): void {
    this.assertActive("write to terminal");
    this.sendBridgeCommand({
      type: "write",
      data,
    });
  }

  resize(size: StationTerminalSize): void {
    this.assertActive("resize terminal");
    const nextSize = normalizeSize(size);
    this.#size = nextSize;
    this.sendBridgeCommand({
      type: "resize",
      cols: nextSize.cols,
      rows: nextSize.rows,
    });
  }

  kill(signal?: string): void {
    if (this.#disposed || this.#exited) {
      return;
    }

    this.sendBridgeCommand({
      type: "kill",
      signal,
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#pendingData = [];
    this.#dataListeners.clear();
    this.#exitListeners.clear();

    if (!this.#exited) {
      this.#bridge.kill();
    }
  }

  private handleBridgeOutput(chunk: string): void {
    this.#stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.#stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.#stdoutBuffer.slice(0, newlineIndex);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      this.handleBridgeMessage(JSON.parse(line) as BridgeMessage);
    }
  }

  private handleBridgeMessage(message: BridgeMessage): void {
    switch (message.type) {
      case "ready":
        this.#pid = message.pid;
        return;
      case "data":
        this.emitData(message.data);
        return;
      case "exit": {
        const event: StationTerminalExit = {
          exitCode: message.exitCode,
        };
        if (message.signal !== undefined) {
          event.signal = message.signal;
        }
        this.emitExit(event);
      }
    }
  }

  private emitData(data: string): void {
    if (this.#dataListeners.size === 0) {
      this.#pendingData.push(data);
      return;
    }

    for (const listener of this.#dataListeners) {
      listener(data);
    }
  }

  private emitExit(event: StationTerminalExit): void {
    this.#exited = true;
    for (const listener of this.#exitListeners) {
      listener(event);
    }
  }

  private sendBridgeCommand(command: object): void {
    this.#bridge.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private assertActive(action: string): void {
    if (this.#disposed) {
      throw new Error(`Cannot ${action} after terminal ${this.id} is disposed.`);
    }
  }
}

function createTerminalId(): string {
  nextTerminalSequence += 1;
  return `terminal-${nextTerminalSequence}`;
}

function resolveNodeCommand(): string {
  return process.env.WOSM_STATION_NODE ?? "node";
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC ?? "powershell.exe";
  }

  return process.env.SHELL ?? "/bin/zsh";
}

function defaultShellArgs(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  return ["-i"];
}

function createPtyEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string | undefined> {
  const nextEnv = {
    ...process.env,
    ...env,
  };

  // Station renders panes itself, so children should see stable xterm-style capabilities.
  nextEnv.TERM = env?.TERM ?? process.env.TERM ?? "xterm-256color";
  nextEnv.COLORTERM = env?.COLORTERM ?? process.env.COLORTERM ?? "truecolor";

  return nextEnv;
}

function normalizeSize(size: Partial<StationTerminalSize> | undefined): StationTerminalSize {
  return {
    cols: normalizePositiveInteger(size?.cols, DEFAULT_COLS),
    rows: normalizePositiveInteger(size?.rows, DEFAULT_ROWS),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}

function signalToNumber(signal: NodeJS.Signals): number {
  return signal === "SIGHUP" ? 1 : 0;
}
