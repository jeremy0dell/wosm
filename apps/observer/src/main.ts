#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { type LoadedWosmConfig, loadConfig, type WosmConfig } from "@wosm/config";
import { systemClock } from "@wosm/runtime";
import { createObserverApi } from "./api.js";
import { createCommandQueue } from "./commandQueue.js";
import { createObserverEventBus } from "./eventBus.js";
import { hookSpoolDir } from "./hookSpool.js";
import { createObserverLogger } from "./logging.js";
import { createObserverPersistence } from "./persistence/index.js";
import { createProviderRegistry } from "./providerFactory.js";
import { createObserverCore } from "./reconcile.js";
import { type ObserverServer, startObserverServer } from "./server.js";
import { openObserverSqlite } from "./sqlite.js";

export async function runObserverMain(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const loadedConfig: LoadedWosmConfig =
    options.configPath === undefined
      ? {
          configPath: "",
          config: emptyConfig(),
          projects: [],
          diagnostics: [],
        }
      : await loadConfig(options.configPath);
  const config = loadedConfig.config;
  const homeDir = homedir();
  const stateDir = resolvePath(
    options.stateDir ?? config.observer?.stateDir ?? "~/.local/state/wosm",
    homeDir,
  );
  const socketPath = resolveObserverSocketPath(options.socketPath, config, stateDir, homeDir);
  const spoolDir = hookSpoolDir(stateDir);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  const clock = systemClock;
  const sqlite = openObserverSqlite({
    path: join(stateDir, "observer.sqlite"),
    clock,
  });
  const persistence = createObserverPersistence({ sqlite, clock });
  const eventBus = createObserverEventBus();
  const logger = createObserverLogger({ stateDir, clock });
  const commandQueue = createCommandQueue({ persistence, clock, eventBus, logger });
  const providers = createProviderRegistry(config);
  const core = createObserverCore({
    config,
    providers,
    persistence,
    sqlite,
    clock,
    logger,
  });

  let server: ObserverServer | undefined;
  let stopResolve: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
  const api = createObserverApi({
    core,
    persistence,
    commandQueue,
    eventBus,
    hookSpoolDir: spoolDir,
    socketPath,
    stateDir,
    diagnosticsDir: join(stateDir, "diagnostics"),
    logPaths: [logger.path],
    config,
    ...(options.configPath === undefined ? {} : { configPath: loadedConfig.configPath }),
    configDiagnostics: loadedConfig.diagnostics,
    clock,
    logger,
    onStop: () => {
      setTimeout(() => {
        void server?.close().finally(stopResolve);
      }, 0);
    },
  });

  server = await startObserverServer({ socketPath, api, clock });
  const stopFromSignal = () => {
    void server?.close().finally(stopResolve);
  };
  process.once("SIGINT", stopFromSignal);
  process.once("SIGTERM", stopFromSignal);

  await stopped;
  sqlite.close();
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runObserverMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

function parseArgs(argv: string[]): {
  configPath?: string;
  socketPath?: string;
  stateDir?: string;
} {
  const result: {
    configPath?: string;
    socketPath?: string;
    stateDir?: string;
  } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--config" && value !== undefined) {
      result.configPath = value;
      index += 1;
    } else if (arg === "--socket" && value !== undefined) {
      result.socketPath = value;
      index += 1;
    } else if (arg === "--state-dir" && value !== undefined) {
      result.stateDir = value;
      index += 1;
    }
  }
  return result;
}

function emptyConfig(): WosmConfig {
  return {
    schemaVersion: 1,
    defaults: {
      worktreeProvider: "noop-worktree",
      terminal: "noop-terminal",
      harness: "noop-harness",
      layout: "agent-shell",
    },
    projects: [],
  };
}

function resolveObserverSocketPath(
  socketPath: string | undefined,
  config: WosmConfig,
  stateDir: string,
  homeDir: string,
): string {
  if (socketPath !== undefined) {
    return resolvePath(socketPath, homeDir);
  }
  if (config.observer?.socketPath !== undefined) {
    return resolvePath(config.observer.socketPath, homeDir);
  }
  if (process.env.XDG_RUNTIME_DIR !== undefined && process.env.XDG_RUNTIME_DIR.length > 0) {
    return join(process.env.XDG_RUNTIME_DIR, "wosm", "observer.sock");
  }
  return join(stateDir, "run", "observer.sock");
}

function resolvePath(input: string, homeDir: string): string {
  const expanded =
    input === "~" ? homeDir : input.startsWith("~/") ? join(homeDir, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}
