import { fileURLToPath } from "node:url";

export const wosmAliases = {
  "@wosm/cli": fileURLToPath(new URL("./apps/cli/src/index.ts", import.meta.url)),
  "@wosm/observer/internal": fileURLToPath(
    new URL("./apps/observer/src/internal.ts", import.meta.url),
  ),
  "@wosm/observer": fileURLToPath(new URL("./apps/observer/src/index.ts", import.meta.url)),
  "@wosm/tui": fileURLToPath(new URL("./apps/tui/src/index.ts", import.meta.url)),
  "@wosm/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
  "@wosm/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
  "@wosm/codex": fileURLToPath(
    new URL("./integrations/harness/codex/src/index.ts", import.meta.url),
  ),
  "@wosm/opencode": fileURLToPath(
    new URL("./integrations/harness/opencode/src/index.ts", import.meta.url),
  ),
  "@wosm/observability": fileURLToPath(
    new URL("./packages/observability/src/index.ts", import.meta.url),
  ),
  "@wosm/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  "@wosm/runtime": fileURLToPath(new URL("./packages/runtime/src/index.ts", import.meta.url)),
  "@wosm/scripted-harness": fileURLToPath(
    new URL("./integrations/harness/scripted/src/index.ts", import.meta.url),
  ),
  "@wosm/testing": fileURLToPath(new URL("./packages/testing/src/index.ts", import.meta.url)),
  "@wosm/tmux": fileURLToPath(
    new URL("./integrations/terminal/tmux/src/index.ts", import.meta.url),
  ),
  "@wosm/worktrunk": fileURLToPath(
    new URL("./integrations/worktree/worktrunk/src/index.ts", import.meta.url),
  ),
};

export const commonResolveConfig = {
  resolve: {
    alias: wosmAliases,
  },
} as const;

export const commonTestConfig = {
  environment: "node",
  globals: false,
  passWithNoTests: false,
} as const;
