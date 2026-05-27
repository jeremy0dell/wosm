import type {
  HarnessProvider,
  RepositoryProvider,
  TerminalProvider,
  WorktreeProvider,
} from "@wosm/contracts";

export type ProviderRegistryInput = {
  worktree: WorktreeProvider;
  terminal: TerminalProvider;
  harnesses: Iterable<HarnessProvider> | Map<string, HarnessProvider>;
  repositories?: Iterable<RepositoryProvider> | Map<string, RepositoryProvider>;
};

export class ProviderRegistry {
  readonly worktree: WorktreeProvider;
  readonly terminal: TerminalProvider;
  readonly harnesses: Map<string, HarnessProvider>;
  readonly repositories: Map<string, RepositoryProvider>;

  constructor(input: ProviderRegistryInput) {
    this.worktree = input.worktree;
    this.terminal = input.terminal;

    if (input.harnesses instanceof Map) {
      this.harnesses = new Map(input.harnesses);
    } else {
      this.harnesses = new Map();
      for (const provider of input.harnesses) {
        if (this.harnesses.has(provider.id)) {
          throw new Error(`Duplicate harness provider id: ${provider.id}`);
        }
        this.harnesses.set(provider.id, provider);
      }
    }

    if (input.repositories instanceof Map) {
      this.repositories = new Map(input.repositories);
    } else {
      this.repositories = new Map();
      for (const provider of input.repositories ?? []) {
        if (this.repositories.has(provider.id)) {
          throw new Error(`Duplicate repository provider id: ${provider.id}`);
        }
        this.repositories.set(provider.id, provider);
      }
    }
  }
}
