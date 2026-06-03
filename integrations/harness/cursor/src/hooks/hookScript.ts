import { CURSOR_HOOK_EVENT_NAMES, type CursorHookEventName } from "./hookConstants.js";

export type CursorHookScriptOptions = {
  hookScriptPath: string;
  wosmConfigPath?: string;
  observerSocketPath?: string;
  stateDir?: string;
  hookSpoolDir?: string;
  autoStartFromHooks?: boolean;
  hookBin?: string;
};

function commandLine(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function expectedCursorHookCommands(input: {
  hookScriptPath: string;
}): Record<CursorHookEventName, string> {
  return Object.fromEntries(
    CURSOR_HOOK_EVENT_NAMES.map((eventName) => [eventName, input.hookScriptPath]),
  ) as Record<CursorHookEventName, string>;
}

export function expectedCursorHookScript(input: CursorHookScriptOptions): string {
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
  hookArgs.push("cursor");
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
