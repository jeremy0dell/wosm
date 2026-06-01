import { readFile, writeFile } from "node:fs/promises";
import type { WosmConfig } from "@wosm/config";

export type EventHooksCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
};

export type EventHookPlanResult = {
  provider: "event";
  hookId: string;
  configPath: string;
  changed: boolean;
  installed: boolean;
  before: string;
  after: string;
};

export type EventHookInstallResult = EventHookPlanResult & {
  installed: boolean;
};

export type EventHookDoctorResult = {
  provider: "event";
  status: "ok" | "warn";
  installed: boolean;
  hooks: string[];
  message: string;
};

export type EventHooksCommandResult =
  | EventHookPlanResult
  | EventHookInstallResult
  | EventHookDoctorResult;

const builtInHookName = "notify-turn-completion";
const builtInHookId = "notify-agent-idle";

export async function runEventHooksCommand(
  args: string[],
  options: EventHooksCommandOptions = {},
): Promise<EventHooksCommandResult> {
  const [action, name] = args;
  const flags = parseFlags(args.slice(2));
  if (action === "doctor") {
    return doctorEventHooks(options.config);
  }
  if (name !== builtInHookName) {
    throw new Error(`Unknown event hook example: ${name ?? ""}`);
  }
  if (action === "plan") {
    return planBuiltInEventHook(options, flags);
  }
  if (action === "install") {
    if (!flags.yes) {
      throw new Error("Refusing to install event hook without --yes.");
    }
    const plan = await planBuiltInEventHook(options, flags);
    if (plan.changed) {
      await writeFile(plan.configPath, plan.after, "utf8");
    }
    return { ...plan, installed: true };
  }
  throw new Error("Usage: wosm hooks plan|install event notify-turn-completion [--yes]");
}

type ParsedFlags = {
  yes: boolean;
  force: boolean;
};

async function planBuiltInEventHook(
  options: EventHooksCommandOptions,
  flags: ParsedFlags,
): Promise<EventHookPlanResult> {
  const configPath = requiredConfigPath(options);
  const before = await readFile(configPath, "utf8");
  const installed = (options.config?.hooks?.event ?? []).some((hook) => hook.id === builtInHookId);
  if (installed && !flags.force) {
    return {
      provider: "event",
      hookId: builtInHookId,
      configPath,
      changed: false,
      installed: true,
      before,
      after: before,
    };
  }
  const after = `${before.trimEnd()}\n\n${builtInEventHookToml()}\n`;
  return {
    provider: "event",
    hookId: builtInHookId,
    configPath,
    changed: after !== before,
    installed: false,
    before,
    after,
  };
}

function doctorEventHooks(config: WosmConfig | undefined): EventHookDoctorResult {
  const hooks = config?.hooks?.event ?? [];
  const ids = hooks.map((hook) => hook.id);
  const installed = ids.includes(builtInHookId);
  if (!installed) {
    return {
      provider: "event",
      status: "warn",
      installed: false,
      hooks: ids,
      message: "Built-in turn completion notification event hook is not installed.",
    };
  }
  return {
    provider: "event",
    status: "ok",
    installed: true,
    hooks: ids,
    message: "Built-in turn completion notification event hook is installed.",
  };
}

function builtInEventHookToml(): string {
  return [
    "[[hooks.event]]",
    `id = ${JSON.stringify(builtInHookId)}`,
    'events = ["worktree.agentStateChanged"]',
    'command = "wosm"',
    'args = ["notify", "turn-completion"]',
    "timeout_ms = 3000",
    "",
    "[hooks.event.filter]",
    'agent_state = "idle"',
  ].join("\n");
}

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = { yes: false, force: false };
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") {
      flags.yes = true;
      continue;
    }
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    throw new Error(`Unknown event hook option: ${arg}`);
  }
  return flags;
}

function requiredConfigPath(options: EventHooksCommandOptions): string {
  if (options.configPath === undefined || options.configPath.length === 0) {
    throw new Error("Event hook installation requires a wosm config path.");
  }
  return options.configPath;
}
