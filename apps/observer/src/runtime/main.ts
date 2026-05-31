#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { type LoadedWosmConfig, loadConfig, type WosmConfig } from "@wosm/config";
import { componentLogPath } from "@wosm/observability";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { createCommandQueue } from "../commands/queue.js";
import { registerObserverCommandHandlers } from "../commands/router.js";
import { createFeatureFlagEvaluator } from "../features/evaluator.js";
import { hookSpoolDir } from "../hooks/spool.js";
import { createObserverPersistence } from "../persistence/index.js";
import {
  providerObservationLegacyCutoff,
  providerObservationRetentionDays,
} from "../persistence/retention.js";
import { createProviderRegistry } from "../providers/factory.js";
import { createObserverCore, providerProjectsFromConfig } from "../reconcile/core.js";
import { openObserverSqlite } from "../sqlite.js";
import { createObserverApi } from "./api.js";
import { emptyConfig } from "./emptyConfig.js";
import { createObserverEventBus } from "./eventBus.js";
import { createObserverLogger } from "./logging.js";
import { type ObserverServer, startObserverServer } from "./server.js";

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

  const sqlite = openObserverSqlite({
    path: join(stateDir, "observer.sqlite"),
    clock: systemClock,
  });
  const persistence = createObserverPersistence({ sqlite, clock: systemClock });
  const eventBus = createObserverEventBus();
  const logger = createObserverLogger({ stateDir, clock: systemClock });
  const retentionDays = providerObservationRetentionDays(config.observability?.retention);
  const pruneAt = toIsoTimestamp(systemClock.now());
  await persistence.pruneExpiredProviderObservations(
    pruneAt,
    providerObservationLegacyCutoff(pruneAt, retentionDays),
  );
  const commandQueue = createCommandQueue({ persistence, clock: systemClock, eventBus, logger });
  const providerOptions: Parameters<typeof createProviderRegistry>[1] = {};
  if (options.configPath !== undefined) {
    providerOptions.configPath = loadedConfig.configPath;
  }
  const providers = createProviderRegistry(config, providerOptions);
  const featureFlags = createFeatureFlagEvaluator({
    ...(config.featureFlags === undefined ? {} : { overrides: config.featureFlags }),
    revisionSeed: loadedConfig.configPath,
  });
  const core = createObserverCore({
    config,
    providers,
    persistence,
    sqlite,
    clock: systemClock,
    logger,
    featureFlags,
  });
  registerObserverCommandHandlers({
    queue: commandQueue,
    core,
    providers,
    projects: providerProjectsFromConfig(config),
    persistence,
    eventBus,
    clock: systemClock,
    logger,
  });

  let server: ObserverServer | undefined;
  let stopResolve: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
  let stopping: Promise<void> | undefined;
  const stopObserver = async () => {
    stopping ??= (async () => {
      await commandQueue.shutdown();
      await server?.close();
      stopResolve();
    })();
    await stopping;
  };
  const api = createObserverApi({
    core,
    providers,
    persistence,
    commandQueue,
    eventBus,
    hookSpoolDir: spoolDir,
    socketPath,
    stateDir,
    diagnosticsDir: join(stateDir, "diagnostics"),
    logPaths: [logger.path, componentLogPath(stateDir, "hook")],
    config,
    ...(options.configPath === undefined ? {} : { configPath: loadedConfig.configPath }),
    configDiagnostics: loadedConfig.diagnostics,
    clock: systemClock,
    logger,
    onStop: () => {
      setTimeout(() => {
        void stopObserver();
      }, 0);
    },
  });

  server = await startObserverServer({ socketPath, api, clock: systemClock });
  const stopFromSignal = () => {
    void api.stop();
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
