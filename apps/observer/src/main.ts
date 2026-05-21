#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig, type WosmConfig } from "@wosm/config";
import type {
  HarnessCapabilities,
  HarnessProvider,
  HarnessRunObservation,
  ProviderHealth,
  TerminalCapabilities,
  TerminalProvider,
  TerminalTargetObservation,
  WorktreeCapabilities,
  WorktreeObservation,
  WorktreeProvider,
} from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { createObserverApi } from "./api.js";
import { createCommandQueue } from "./commandQueue.js";
import { createObserverEventBus } from "./eventBus.js";
import { hookSpoolDir } from "./hookSpool.js";
import { createObserverPersistence } from "./persistence/index.js";
import { ProviderRegistry } from "./providerRegistry.js";
import { createObserverCore } from "./reconcile.js";
import { type ObserverServer, startObserverServer } from "./server.js";
import { openObserverSqlite } from "./sqlite.js";

export async function runObserverMain(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const config =
    options.configPath === undefined
      ? emptyConfig()
      : (await loadConfig(options.configPath)).config;
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
  const commandQueue = createCommandQueue({ persistence, clock, eventBus });
  const providers = createNoopProviders(config);
  const core = createObserverCore({
    config,
    providers,
    persistence,
    sqlite,
    clock,
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
    clock,
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

function createNoopProviders(config: WosmConfig): ProviderRegistry {
  return new ProviderRegistry({
    worktree: new NoopWorktreeProvider(config.defaults.worktreeProvider),
    terminal: new NoopTerminalProvider(config.defaults.terminal),
    harnesses: [new NoopHarnessProvider(config.defaults.harness)],
  });
}

function health(providerId: string, providerType: ProviderHealth["providerType"]): ProviderHealth {
  return {
    providerId,
    providerType,
    status: "healthy",
    lastCheckedAt: toIsoTimestamp(systemClock.now()),
  };
}

class NoopWorktreeProvider implements WorktreeProvider {
  constructor(readonly id: string) {}

  capabilities(): WorktreeCapabilities {
    return {
      canCreate: false,
      canRemove: false,
      canList: true,
      canEmitLifecycleEvents: true,
      canExposeDirtyState: false,
    };
  }

  async health(): Promise<ProviderHealth> {
    return health(this.id, "worktree");
  }

  async listWorktrees(): Promise<WorktreeObservation[]> {
    return [];
  }

  async createWorktree(): Promise<WorktreeObservation> {
    throw new Error("No worktree provider is configured.");
  }

  async removeWorktree(): Promise<{ worktreeId: string; removed: boolean; reason?: string }> {
    return { worktreeId: "unknown", removed: false, reason: "No worktree provider is configured." };
  }
}

class NoopTerminalProvider implements TerminalProvider {
  constructor(readonly id: string) {}

  capabilities(): TerminalCapabilities {
    return {
      canOpenWorkspace: false,
      canFocusTarget: false,
      canCloseTarget: false,
      canCaptureOutput: false,
      canSendInput: false,
      canPersistIdentityBinding: false,
      canDisplayPopup: false,
    };
  }

  async health(): Promise<ProviderHealth> {
    return health(this.id, "terminal");
  }

  async listTargets(): Promise<TerminalTargetObservation[]> {
    return [];
  }

  async openWorkspace(): Promise<never> {
    throw new Error("No terminal provider is configured.");
  }

  async focusTarget(): Promise<void> {}

  async closeTarget(): Promise<void> {}
}

class NoopHarnessProvider implements HarnessProvider {
  constructor(readonly id: string) {}

  capabilities(): HarnessCapabilities {
    return {
      canLaunch: false,
      canDiscoverRuns: true,
      canEmitEvents: true,
      canClassifyStatus: false,
      canReceivePrompt: false,
      canResume: false,
      canStop: false,
      canRunNonInteractive: false,
      canExposeApprovalState: false,
    };
  }

  async health(): Promise<ProviderHealth> {
    return health(this.id, "harness");
  }

  async buildLaunch(): Promise<never> {
    throw new Error("No harness provider is configured.");
  }

  async discoverRuns(): Promise<HarnessRunObservation[]> {
    return [];
  }

  async classifyRun(): Promise<never> {
    throw new Error("No harness provider is configured.");
  }
}
