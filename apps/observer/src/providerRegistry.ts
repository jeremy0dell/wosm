import type { HarnessProvider, TerminalProvider, WorktreeProvider } from "@wosm/contracts";

export type ProviderRegistryInput = {
  worktree: WorktreeProvider;
  terminal: TerminalProvider;
  harnesses: Iterable<HarnessProvider> | Map<string, HarnessProvider>;
};

export class ProviderRegistry {
  readonly worktree: WorktreeProvider;
  readonly terminal: TerminalProvider;
  readonly harnesses: Map<string, HarnessProvider>;

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
  }
}
