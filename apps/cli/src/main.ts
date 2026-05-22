#!/usr/bin/env node
import { loadConfig } from "@wosm/config";
import { runDebugBundleCommand } from "./commands/debugBundle.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runHookCommand } from "./commands/hook.js";
import { observerCommandSummary, runObserverCommand } from "./commands/observer.js";
import { type PopupCommandDeps, runPopupCommand } from "./commands/popup.js";
import { runReconcileCommand } from "./commands/reconcile.js";
import { runSnapshotCommand } from "./commands/snapshot.js";
import { runTuiCommand, type TuiCommandDeps } from "./commands/tui.js";
import { runWorktrunkHooksCommand } from "./commands/worktrunkHooks.js";
import type { HookReceiverDeps } from "./hookReceiver.js";
import type { ObserverProcessDeps } from "./observerProcess.js";

export type CliRunResult = {
  code: number;
  output?: unknown;
};

export type CliRunOptions = {
  stdin?: string | undefined;
  hookDeps?: HookReceiverDeps | undefined;
  observerDeps?: ObserverProcessDeps | undefined;
  popupDeps?: PopupCommandDeps | undefined;
  tuiDeps?: TuiCommandDeps | undefined;
};

export async function runCli(
  argv = process.argv.slice(2),
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const { args, configPath } = parseGlobalOptions(argv);
  const command = args[0] ?? "tui";
  const commandArgs = args[0] === undefined ? [] : args.slice(1);
  const loaded = commandRequiresConfig(command, commandArgs)
    ? configPath === undefined
      ? await loadConfig()
      : await loadConfig(configPath)
    : undefined;
  const config = loaded?.config;
  const resolvedConfigPath = loaded?.configPath;

  if (command === "observer") {
    const result = await runObserverCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: observerCommandSummary(result) };
  }

  if (command === "doctor") {
    const result = await runDoctorCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: result.status === "unavailable" ? 1 : 0, output: result };
  }

  if (command === "debug" && commandArgs[0] === "bundle") {
    const result = await runDebugBundleCommand(
      commandArgs.slice(1),
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "hook") {
    const stdin = options.stdin ?? (await readStdinIfAvailable());
    const result = await runHookCommand(commandArgs, { config, stdin }, options.hookDeps);
    return { code: result.status === "rejected" ? 1 : 0, output: result };
  }

  if (command === "popup") {
    const result = await runPopupCommand(args.slice(1), { config }, options.popupDeps);
    return { code: 0, output: result };
  }

  if (command === "tui") {
    const tuiDeps: TuiCommandDeps = {};
    if (options.observerDeps !== undefined) tuiDeps.observer = options.observerDeps;
    if (options.tuiDeps?.runTui !== undefined) tuiDeps.runTui = options.tuiDeps.runTui;
    const result = await runTuiCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      tuiDeps,
    );
    return { code: result.code, output: result };
  }

  if (command === "snapshot") {
    const result = await runSnapshotCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "reconcile") {
    const result = await runReconcileCommand(
      commandArgs,
      { config, configPath: resolvedConfigPath },
      options.observerDeps,
    );
    return { code: 0, output: result };
  }

  if (command === "worktrunk" && commandArgs[0] === "hooks") {
    const result = await runWorktrunkHooksCommand(commandArgs.slice(1), {
      config,
      configPath: resolvedConfigPath,
    });
    return { code: "status" in result && result.status === "warn" ? 1 : 0, output: result };
  }

  if (command === "hooks" && (commandArgs[0] === "install" || commandArgs[0] === "uninstall")) {
    if (commandArgs[1] !== "worktrunk") {
      throw new Error(`Unknown hook provider: ${commandArgs[1] ?? ""}`);
    }
    const result = await runWorktrunkHooksCommand([commandArgs[0], ...commandArgs.slice(2)], {
      config,
      configPath: resolvedConfigPath,
    });
    return { code: 0, output: result };
  }

  throw new Error(`Unknown command: ${command ?? ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const invoked = parseGlobalOptions(process.argv.slice(2)).args;
  const suppressOutput = invoked[0] === undefined || invoked[0] === "tui";
  runCli()
    .then((result) => {
      if (!suppressOutput && result.output !== undefined) {
        process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
      }
      if (suppressOutput) {
        if (result.code !== 0 && result.output !== undefined) {
          process.stderr.write(`${JSON.stringify(result.output, null, 2)}\n`);
        }
        process.exit(result.code);
      }
      process.exitCode = result.code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
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

function commandRequiresConfig(command: string, args: string[]): boolean {
  if (command === "debug") {
    return args[0] === "bundle";
  }
  return [
    "doctor",
    "hook",
    "hooks",
    "observer",
    "popup",
    "reconcile",
    "snapshot",
    "tui",
    "worktrunk",
  ].includes(command);
}

async function readStdinIfAvailable(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
