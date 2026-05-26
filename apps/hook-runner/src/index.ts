import { fileURLToPath } from "node:url";
import { codexHookAdapter } from "@wosm/codex";
import { loadConfig } from "@wosm/config";
import type { HookReceipt, ProviderHookAdapter } from "@wosm/contracts";
import {
  type HookBridgeCommandOptions,
  type HookReceiverDeps,
  runHookBridgeCommand,
} from "@wosm/hook-bridge";
import { worktrunkHookAdapter } from "@wosm/worktrunk";

export type HookRunnerOptions = {
  stdin?: string | undefined;
  env?: Record<string, string | undefined> | undefined;
  hookDeps?: HookReceiverDeps | undefined;
  observerEntryPath?: string | undefined;
};

export type HookRunnerResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const defaultProviderHookAdapters: readonly ProviderHookAdapter[] = [
  codexHookAdapter,
  worktrunkHookAdapter,
];

export async function runHookRunner(
  argv = process.argv.slice(2),
  options: HookRunnerOptions = {},
): Promise<HookRunnerResult> {
  try {
    const { args, configPath } = parseGlobalOptions(argv);
    const loaded = configPath === undefined ? await loadConfig() : await loadConfig(configPath);
    const bridgeOptions: HookBridgeCommandOptions = {
      config: loaded.config,
      configPath: loaded.configPath,
      stdin: options.stdin,
      env: options.env,
      observerEntryPath: options.observerEntryPath ?? defaultHookObserverEntryPath(),
      providerAdapters: defaultProviderHookAdapters,
    };
    const receipt = await runHookBridgeCommand(args, bridgeOptions, options.hookDeps);
    if (receipt.status === "rejected") {
      return {
        code: 1,
        stdout: "",
        stderr: `${formatRejectedReceipt(receipt)}\n`,
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: `${formatHookRunnerError(error)}\n`,
    };
  }
}

function parseGlobalOptions(argv: string[]): { args: string[]; configPath?: string } {
  const args: string[] = [];
  let configPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      args.push(arg);
    }
  }

  return {
    args,
    ...(configPath === undefined ? {} : { configPath }),
  };
}

function defaultHookObserverEntryPath(): string {
  return fileURLToPath(new URL("../../observer/dist/runtime/main.js", import.meta.url));
}

function formatRejectedReceipt(receipt: HookReceipt): string {
  const output: Record<string, unknown> = {
    status: receipt.status,
    provider: receipt.provider,
    event: receipt.event,
  };
  if (receipt.error !== undefined) {
    output.error = receipt.error;
  }
  return JSON.stringify(output);
}

function formatHookRunnerError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
