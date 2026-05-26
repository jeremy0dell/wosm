export const CODEX_WOSM_PROFILE_NAME = "wosm";
export const CODEX_WOSM_PROFILE_CONFIG_FILE = "wosm.config.toml";
export const CODEX_BASE_CONFIG_FILE = "config.toml";
export const GENERATED_HOOK_STATUS_MESSAGE = "Notify wosm";
export const GENERATED_HOOK_SCRIPT_NAME = "wosm-codex-hook.sh";

export const CODEX_HOOK_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type CodexHookEventName = (typeof CODEX_HOOK_EVENT_NAMES)[number];
