#!/usr/bin/env node
import { loadConfig } from "@wosm/config";
import { runHookCommand } from "./commands/hook.js";
import { observerCommandSummary, runObserverCommand } from "./commands/observer.js";
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
};

export async function runCli(
  argv = process.argv.slice(2),
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const { args, configPath } = parseGlobalOptions(argv);
  const command = args[0];
  const config = configPath === undefined ? undefined : (await loadConfig(configPath)).config;

  if (command === "observer") {
    const result = await runObserverCommand(
      args.slice(1),
      { config, configPath },
      options.observerDeps,
    );
    return { code: 0, output: observerCommandSummary(result) };
  }

  if (command === "hook") {
    const stdin = options.stdin ?? (await readStdinIfAvailable());
    const result = await runHookCommand(args.slice(1), { config, stdin }, options.hookDeps);
    return { code: result.status === "rejected" ? 1 : 0, output: result };
  }

  throw new Error(`Unknown command: ${command ?? ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli()
    .then((result) => {
      if (result.output !== undefined) {
        process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
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
