import { join } from "node:path";
import { CodexHarnessProvider } from "@wosm/codex";
import type { WosmConfig } from "@wosm/config";
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
import { OpenCodeHarnessProvider } from "@wosm/opencode";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { ScriptedAgentHarnessProvider } from "@wosm/scripted-harness";
import { TmuxProvider } from "@wosm/tmux";
import { WorktrunkProvider } from "@wosm/worktrunk";
import { ProviderRegistry } from "./registry.js";

export function createProviderRegistry(config: WosmConfig): ProviderRegistry {
  return new ProviderRegistry({
    worktree: createWorktreeProvider(config),
    terminal: createTerminalProvider(config),
    harnesses: createHarnessProviders(config),
  });
}

function createWorktreeProvider(config: WosmConfig): WorktreeProvider {
  if (config.defaults.worktreeProvider === "worktrunk") {
    return new WorktrunkProvider({
      ...(config.worktree?.worktrunk?.command === undefined
        ? {}
        : { command: config.worktree.worktrunk.command }),
      ...(config.worktree?.worktrunk?.configPath === undefined
        ? {}
        : { configPath: config.worktree.worktrunk.configPath }),
    });
  }

  return new NoopWorktreeProvider(config.defaults.worktreeProvider);
}

function createTerminalProvider(config: WosmConfig): TerminalProvider {
  if (config.defaults.terminal === "tmux") {
    return new TmuxProvider({
      ...(config.terminal?.tmux === undefined ? {} : { config: config.terminal.tmux }),
    });
  }

  return new NoopTerminalProvider(config.defaults.terminal);
}

function createHarnessProviders(config: WosmConfig): HarnessProvider[] {
  const ids = new Set<string>([
    config.defaults.harness,
    ...config.projects.map((project) => project.defaults.harness),
    ...Object.keys(config.harness ?? {}),
  ]);
  return [...ids].map((id) => createHarnessProvider(id, config));
}

function createHarnessProvider(id: string, config: WosmConfig): HarnessProvider {
  if (id === "scripted") {
    return new ScriptedAgentHarnessProvider({
      stateDir: join(config.observer?.stateDir ?? process.cwd(), "scripted"),
      ...(config.harness?.scripted?.command === undefined
        ? {}
        : { nodeCommand: config.harness.scripted.command }),
    });
  }

  if (id === "codex") {
    return new CodexHarnessProvider({
      ...(config.harness?.codex?.command === undefined
        ? {}
        : { command: config.harness.codex.command }),
    });
  }

  if (id === "opencode") {
    return new OpenCodeHarnessProvider({
      ...(config.harness?.opencode?.command === undefined
        ? {}
        : { command: config.harness.opencode.command }),
    });
  }

  return new NoopHarnessProvider(id);
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
