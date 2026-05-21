import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WosmConfig } from "@wosm/config";

export async function createTempState(): Promise<{
  root: string;
  stateDir: string;
  socketPath: string;
  hookSpoolDir: string;
  config: WosmConfig;
}> {
  const root = await mkdtemp(join(tmpdir(), "wosm-project-"));
  const stateDir = join(root, "state");
  const socketPath = join(root, "run", "observer.sock");
  await mkdir(stateDir, { recursive: true });
  return {
    root,
    stateDir,
    socketPath,
    hookSpoolDir: join(stateDir, "spool", "hooks"),
    config: {
      schemaVersion: 1,
      observer: {
        stateDir,
        socketPath,
        autoStartFromHooks: true,
      },
      defaults: {
        worktreeProvider: "fake-worktree",
        terminal: "fake-terminal",
        harness: "fake-harness",
        layout: "agent-shell",
      },
      projects: [],
    },
  };
}

export async function writeConfigToml(root: string, config: WosmConfig): Promise<string> {
  const path = join(root, "config.toml");
  await writeFile(
    path,
    [
      "schema_version = 1",
      "projects = []",
      "",
      "[observer]",
      `socket_path = ${JSON.stringify(config.observer?.socketPath)}`,
      `state_dir = ${JSON.stringify(config.observer?.stateDir)}`,
      `auto_start_from_hooks = ${config.observer?.autoStartFromHooks ?? true}`,
      "",
      "[defaults]",
      `worktree_provider = ${JSON.stringify(config.defaults.worktreeProvider)}`,
      `terminal = ${JSON.stringify(config.defaults.terminal)}`,
      `harness = ${JSON.stringify(config.defaults.harness)}`,
      `layout = ${JSON.stringify(config.defaults.layout)}`,
      "",
      ...(config.terminal?.tmux === undefined
        ? []
        : [
            "[terminal.tmux]",
            ...(config.terminal.tmux.popupWidth === undefined
              ? []
              : [`popup_width = ${JSON.stringify(config.terminal.tmux.popupWidth)}`]),
            ...(config.terminal.tmux.popupHeight === undefined
              ? []
              : [`popup_height = ${JSON.stringify(config.terminal.tmux.popupHeight)}`]),
            ...(config.terminal.tmux.popupPosition === undefined
              ? []
              : [`popup_position = ${JSON.stringify(config.terminal.tmux.popupPosition)}`]),
            "",
          ]),
    ].join("\n"),
  );
  return path;
}
