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
    const options: ConstructorParameters<typeof WorktrunkProvider>[0] = {};
    if (config.worktree?.worktrunk?.command !== undefined) {
      options.command = config.worktree.worktrunk.command;
    }
    if (config.worktree?.worktrunk?.configPath !== undefined) {
      options.configPath = config.worktree.worktrunk.configPath;
    }
    if (config.worktree?.worktrunk?.useLifecycleHooks !== undefined) {
      options.useLifecycleHooks = config.worktree.worktrunk.useLifecycleHooks;
    }
    return new WorktrunkProvider(options);
  }

  return new NoopWorktreeProvider(config.defaults.worktreeProvider);
}

function createTerminalProvider(config: WosmConfig): TerminalProvider {
  if (config.defaults.terminal === "tmux") {
    const options: ConstructorParameters<typeof TmuxProvider>[0] = {};
    if (config.terminal?.tmux !== undefined) {
      options.config = config.terminal.tmux;
    }
    return new TmuxProvider(options);
  }

  return new NoopTerminalProvider(config.defaults.terminal);
}

function createHarnessProviders(config: WosmConfig): HarnessProvider[] {
  const ids = new Set<string>();
  ids.add(config.defaults.harness);
  for (const project of config.projects) {
    ids.add(project.defaults.harness);
  }
  for (const providerId of Object.keys(config.harness ?? {})) {
    ids.add(providerId);
  }
  return Array.from(ids).map((id) => createHarnessProvider(id, config));
}

function createHarnessProvider(id: string, config: WosmConfig): HarnessProvider {
  if (id === "scripted") {
    const options: ConstructorParameters<typeof ScriptedAgentHarnessProvider>[0] = {
      stateDir: join(config.observer?.stateDir ?? process.cwd(), "scripted"),
    };
    if (config.harness?.scripted?.command !== undefined) {
      options.nodeCommand = config.harness.scripted.command;
    }
    return new ScriptedAgentHarnessProvider(options);
  }

  if (id === "codex") {
    const options: ConstructorParameters<typeof CodexHarnessProvider>[0] = {};
    if (config.harness?.codex?.command !== undefined) {
      options.command = config.harness.codex.command;
    }
    if (config.harness?.codex?.profile !== undefined) {
      options.profile = config.harness.codex.profile;
    }
    if (config.harness?.codex?.approvalPolicy !== undefined) {
      options.approvalPolicy = config.harness.codex.approvalPolicy;
    }
    if (config.harness?.codex?.sandboxMode !== undefined) {
      options.sandboxMode = config.harness.codex.sandboxMode;
    }
    if (config.harness?.codex?.installHooks !== undefined) {
      options.installHooks = config.harness.codex.installHooks;
    }
    if (config.observer?.stateDir !== undefined) {
      options.stateDir = config.observer.stateDir;
    }
    return new CodexHarnessProvider(options);
  }

  if (id === "opencode") {
    const options: ConstructorParameters<typeof OpenCodeHarnessProvider>[0] = {};
    if (config.harness?.opencode?.command !== undefined) {
      options.command = config.harness.opencode.command;
    }
    return new OpenCodeHarnessProvider(options);
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
