import { readFile, writeFile } from "node:fs/promises";
import type { WosmConfig } from "@wosm/config";
import type { ExternalCommandInput, ExternalCommandRunner } from "@wosm/runtime";
import { runExternalCommand, safeErrorFromUnknown } from "@wosm/runtime";
import type { CliEnv } from "../env.js";

export type EventHooksCommandOptions = {
  config?: WosmConfig | undefined;
  configPath?: string | undefined;
  commandRunner?: ExternalCommandRunner | undefined;
  env?: CliEnv | undefined;
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
  commandCheck?: EventHookCommandCheck;
};

export type EventHookCommandCheck = {
  status: "ok" | "warn";
  command: string;
  message: string;
  error?: string;
};

export type EventHooksCommandResult =
  | EventHookPlanResult
  | EventHookInstallResult
  | EventHookDoctorResult;

type ParsedFlags = {
  yes: boolean;
  force: boolean;
};

const builtInHookName = "notify-turn-completion";
const builtInHookId = "notify-agent-idle";

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

async function doctorEventHooks(options: EventHooksCommandOptions): Promise<EventHookDoctorResult> {
  const config = options.config;
  const hooks = config?.hooks?.event ?? [];
  const ids = hooks.map((hook) => hook.id);
  const hook = hooks.find((candidate) => candidate.id === builtInHookId);
  if (hook === undefined) {
    return {
      provider: "event",
      status: "warn",
      installed: false,
      hooks: ids,
      message: "Built-in turn completion notification event hook is not installed.",
    };
  }
  const commandCheck = await checkBuiltInNotifyCommand({
    command: hook.command,
    args: hook.args ?? [],
    timeoutMs: hook.timeoutMs ?? 3000,
    commandRunner: options.commandRunner,
    env: options.env,
  });
  if (commandCheck.status === "warn") {
    return {
      provider: "event",
      status: "warn",
      installed: true,
      hooks: ids,
      commandCheck,
      message:
        "Built-in turn completion notification event hook is installed, but its command is not usable.",
    };
  }
  return {
    provider: "event",
    status: "ok",
    installed: true,
    hooks: ids,
    commandCheck,
    message: "Built-in turn completion notification event hook is installed.",
  };
}

async function checkBuiltInNotifyCommand(input: {
  command: string;
  args: string[];
  timeoutMs: number;
  commandRunner?: ExternalCommandRunner | undefined;
  env?: CliEnv | undefined;
}): Promise<EventHookCommandCheck> {
  if (input.command !== "wosm") {
    return checkCommandAvailable(input.command, input.args, input.env);
  }
  const invocation = {
    schemaVersion: "0.3.0",
    hookId: `${builtInHookId}-doctor-check`,
    observedAt: "2026-01-01T00:00:00.000Z",
    event: {
      type: "worktree.agentStateChanged",
      worktreeId: "wt_event_hook_doctor_check",
      agent: {
        harness: "codex",
        state: "working",
        runId: "run_event_hook_doctor_check",
        confidence: "high",
        reason: "Event hook doctor command check.",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  };
  try {
    const commandInput: ExternalCommandInput = {
      command: input.command,
      args: input.args,
      timeoutMs: Math.min(input.timeoutMs, 3000),
      stdin: `${JSON.stringify(invocation)}\n`,
      maxOutputChars: 2000,
    };
    const env = envForExternalCommand(input.env);
    if (env !== undefined) commandInput.env = env;
    await runExternalCommand(commandInput, input.commandRunner);
    return {
      status: "ok",
      command: [input.command, ...input.args].join(" "),
      message: "Configured notification command accepts event hook invocations.",
    };
  } catch (error) {
    const safeError = safeErrorFromUnknown(error, {
      tag: "EventHookError",
      code: "EVENT_HOOK_COMMAND_UNUSABLE",
      message: "Configured notification command is not usable.",
    });
    return {
      status: "warn",
      command: [input.command, ...input.args].join(" "),
      message: "Configured notification command failed the doctor check.",
      error: safeError.message,
    };
  }
}

async function checkCommandAvailable(
  command: string,
  args: string[],
  env: CliEnv | undefined,
): Promise<EventHookCommandCheck> {
  try {
    const commandInput: ExternalCommandInput = {
      command: "sh",
      args: ["-c", 'command -v "$1" >/dev/null', "sh", command],
      timeoutMs: 3000,
      maxOutputChars: 2000,
    };
    const externalEnv = envForExternalCommand(env);
    if (externalEnv !== undefined) commandInput.env = externalEnv;
    await runExternalCommand(commandInput);
    return {
      status: "ok",
      command: [command, ...args].join(" "),
      message: "Configured notification command is available.",
    };
  } catch (error) {
    const safeError = safeErrorFromUnknown(error, {
      tag: "EventHookError",
      code: "EVENT_HOOK_COMMAND_UNUSABLE",
      message: "Configured notification command is not available.",
    });
    return {
      status: "warn",
      command: [command, ...args].join(" "),
      message: "Configured notification command failed the doctor check.",
      error: safeError.message,
    };
  }
}

function envForExternalCommand(env: CliEnv | undefined): Record<string, string> | undefined {
  if (env === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function builtInEventHookToml(): string {
  return [
    "[[hooks.event]]",
    `id = ${JSON.stringify(builtInHookId)}`,
    'events = ["worktree.agentStateChanged"]',
    'command = "osascript"',
    'args = ["-e", "display notification \\"Agent turn complete.\\" with title \\"wosm\\""]',
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

export async function runEventHooksCommand(
  args: string[],
  options: EventHooksCommandOptions = {},
): Promise<EventHooksCommandResult> {
  const [action, name] = args;
  const flags = parseFlags(args.slice(2));
  if (action === "doctor") {
    return doctorEventHooks(options);
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
