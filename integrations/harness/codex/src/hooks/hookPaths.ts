import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  CODEX_BASE_CONFIG_FILE,
  CODEX_WOSM_PROFILE_CONFIG_FILE,
  GENERATED_HOOK_SCRIPT_NAME,
} from "./hookConstants.js";

export type CodexHookPathOptions = {
  codexConfigPath?: string;
  hookScriptPath?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

export function resolveCodexConfigPath(options: CodexHookPathOptions = {}): string {
  if (options.codexConfigPath !== undefined) {
    return resolvePath(options.codexConfigPath, options.homeDir ?? homedir());
  }

  return join(resolveCodexHome(options), CODEX_WOSM_PROFILE_CONFIG_FILE);
}

export function resolveCodexBaseConfigPath(options: CodexHookPathOptions = {}): string {
  return join(resolveCodexHome(options), CODEX_BASE_CONFIG_FILE);
}

export function resolveCodexHookScriptPath(options: CodexHookPathOptions = {}): string {
  if (options.hookScriptPath !== undefined) {
    return resolvePath(options.hookScriptPath, options.homeDir ?? homedir());
  }
  const stateDir = options.stateDir ?? defaultStateDir(options);
  return resolvePath(
    join(stateDir, "hooks", GENERATED_HOOK_SCRIPT_NAME),
    options.homeDir ?? homedir(),
  );
}

function defaultStateDir(options: CodexHookPathOptions): string {
  const env = options.env ?? process.env;
  if (env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME.length > 0) {
    return join(env.XDG_STATE_HOME, "wosm");
  }
  return join(options.homeDir ?? homedir(), ".local", "state", "wosm");
}

function resolveCodexHome(options: CodexHookPathOptions): string {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) {
    return resolvePath(env.CODEX_HOME, homeDir);
  }
  return resolvePath("~/.codex", homeDir);
}

function resolvePath(input: string, homeDir: string): string {
  const expanded =
    input === "~" ? homeDir : input.startsWith("~/") ? join(homeDir, input.slice(2)) : input;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}
