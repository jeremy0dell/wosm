import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { WosmConfig } from "@wosm/config";

export type ObserverPaths = {
  stateDir: string;
  socketPath: string;
  hookSpoolDir: string;
};

export function resolveObserverPaths(config?: WosmConfig, homeDir = homedir()): ObserverPaths {
  const stateDir = resolvePath(config?.observer?.stateDir ?? "~/.local/state/wosm", homeDir);
  const socketPath = resolveSocketPath(config, stateDir, homeDir);
  return {
    stateDir,
    socketPath,
    hookSpoolDir: join(stateDir, "spool", "hooks"),
  };
}

export function resolvePath(input: string, homeDir = homedir(), baseDir = process.cwd()): string {
  const expanded =
    input === "~" ? homeDir : input.startsWith("~/") ? join(homeDir, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

function resolveSocketPath(
  config: WosmConfig | undefined,
  stateDir: string,
  homeDir: string,
): string {
  if (config?.observer?.socketPath !== undefined) {
    return resolvePath(config.observer.socketPath, homeDir);
  }

  if (process.env.XDG_RUNTIME_DIR !== undefined && process.env.XDG_RUNTIME_DIR.length > 0) {
    return join(process.env.XDG_RUNTIME_DIR, "wosm", "observer.sock");
  }

  return join(stateDir, "run", "observer.sock");
}
