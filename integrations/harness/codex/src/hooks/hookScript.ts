import { CODEX_HOOK_EVENT_NAMES, type CodexHookEventName } from "./hookConstants.js";

export type CodexHookScriptOptions = {
  hookScriptPath: string;
  wosmConfigPath?: string;
  observerSocketPath?: string;
  stateDir?: string;
  hookSpoolDir?: string;
  autoStartFromHooks?: boolean;
  hookBin?: string;
};

export function expectedCodexHookCommands(input: {
  hookScriptPath: string;
}): Record<CodexHookEventName, string> {
  return Object.fromEntries(
    CODEX_HOOK_EVENT_NAMES.map((eventName) => [eventName, input.hookScriptPath]),
  ) as Record<CodexHookEventName, string>;
}

export function expectedCodexHookScript(input: CodexHookScriptOptions): string {
  const hookArgs = [input.hookBin ?? "wosm-ingress"];
  if (input.observerSocketPath !== undefined) {
    hookArgs.push("--socket", input.observerSocketPath);
  }
  if (input.stateDir !== undefined) {
    hookArgs.push("--state-dir", input.stateDir);
  }
  if (input.hookSpoolDir !== undefined) {
    hookArgs.push("--spool-dir", input.hookSpoolDir);
  }
  if (input.wosmConfigPath !== undefined) {
    hookArgs.push("--config", input.wosmConfigPath);
  }
  if (input.autoStartFromHooks === false) {
    hookArgs.push("--no-auto-start");
  }
  hookArgs.push("codex");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `if [ -z "\${WOSM_SESSION_ID:-}" ] || [ -z "\${WOSM_WORKTREE_ID:-}" ]; then`,
    "  exit 0",
    "fi",
    `${commandLine(hookArgs)} > /dev/null`,
    "",
  ].join("\n");
}

function commandLine(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
