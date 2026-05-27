import { CODEX_HOOK_EVENT_NAMES, type CodexHookEventName } from "./hookConstants.js";

export type CodexHookScriptOptions = {
  hookScriptPath: string;
  wosmConfigPath?: string;
  hookBin?: string;
  /** @deprecated Use `hookBin`; `wosmBin` generates the legacy `wosm hook ...` command. */
  wosmBin?: string;
};

export function expectedCodexHookCommands(input: {
  hookScriptPath: string;
}): Record<CodexHookEventName, string> {
  return Object.fromEntries(
    CODEX_HOOK_EVENT_NAMES.map((eventName) => [eventName, input.hookScriptPath]),
  ) as Record<CodexHookEventName, string>;
}

export function expectedCodexHookScript(input: CodexHookScriptOptions): string {
  const shellTmpDir = "$" + "{TMPDIR:-/tmp}";
  const legacyWosmBin = input.wosmBin;
  const hookArgs = [legacyWosmBin ?? input.hookBin ?? "wosm-hook"];
  if (input.wosmConfigPath !== undefined) {
    hookArgs.push("--config", input.wosmConfigPath);
  }
  if (legacyWosmBin !== undefined) {
    hookArgs.push("hook");
  }
  hookArgs.push("codex");
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `if [ -z "\${WOSM_SESSION_ID:-}" ] || [ -z "\${WOSM_WORKTREE_ID:-}" ]; then`,
    "  exit 0",
    "fi",
    `payload_file="$(mktemp "${shellTmpDir}/wosm-codex-hook.XXXXXX")"`,
    "trap 'rm -f \"$payload_file\"' EXIT",
    'cat > "$payload_file"',
    'event="$(/usr/bin/env node -e \'const fs = require("node:fs"); const input = fs.readFileSync(process.argv[1], "utf8"); const payload = JSON.parse(input); if (typeof payload.hook_event_name !== "string" || payload.hook_event_name.length === 0) { throw new Error("missing hook_event_name"); } process.stdout.write(payload.hook_event_name);\' "$payload_file")"',
    `${commandLine(hookArgs)} "$event" < "$payload_file" > /dev/null`,
    "",
  ].join("\n");
}

function commandLine(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
