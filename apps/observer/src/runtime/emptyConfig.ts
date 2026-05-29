import type { WosmConfig } from "@wosm/config";

export function emptyConfig(): WosmConfig {
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
