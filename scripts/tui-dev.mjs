#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = join(repoRoot, "apps/cli/dist/main.js");
const args = process.argv.slice(2);
const devSessionName = process.env.WOSM_TUI_SESSION_NAME ?? "_wosm-ui-dev";
const devTuiCommand =
  process.env.WOSM_TUI_COMMAND ??
  shellCommand([process.execPath, "--watch", "--watch-preserve-output", cliEntry]);

const logPath = join(repoRoot, ".turbo/tui-dev-build.log");
await mkdir(dirname(logPath), { recursive: true });

const initialBuild = spawnSync(
  "pnpm",
  ["exec", "turbo", "run", "build", "--filter=@wosm/cli", "--output-logs=errors-only"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);
if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
}

const logFd = openSync(logPath, "a");
writeSync(logFd, `\n--- wosm:tui-dev ${new Date().toISOString()} ---\n`);
const buildWatcher = spawn(
  "pnpm",
  [
    "exec",
    "turbo",
    "watch",
    "build",
    "--filter=@wosm/cli",
    "--ui=stream",
    "--output-logs=errors-only",
    "--continue=always",
  ],
  {
    cwd: repoRoot,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  },
);

const env = {
  ...process.env,
  WOSM_TUI_COMMAND: devTuiCommand,
  WOSM_TUI_SESSION_NAME: devSessionName,
};
const command = commandFromArgs(args);
const runDirectTui = command === "tui" || (command === undefined && !isInsideTmux(process.env));
const nodeArgs = runDirectTui
  ? ["--watch", "--watch-preserve-output", cliEntry, ...args]
  : [cliEntry, ...args];

process.stderr.write(`wosm:tui-dev build watcher: ${logPath}\n`);
const wosm = spawn(process.execPath, nodeArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env,
});

let exiting = false;
const shutdown = (signal) => {
  if (exiting) return;
  exiting = true;
  buildWatcher.kill(signal);
  wosm.kill(signal);
  cleanupDevUiSession();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

wosm.on("exit", (code, signal) => {
  if (!exiting) {
    exiting = true;
    buildWatcher.kill("SIGTERM");
    cleanupDevUiSession();
  }
  closeSync(logFd);
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});

function commandFromArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

function isInsideTmux(env) {
  const tmux = env.TMUX;
  return tmux !== undefined && tmux.length > 0;
}

function cleanupDevUiSession() {
  if (devSessionName !== "_wosm-ui-dev" || !isInsideTmux(process.env)) {
    return;
  }
  spawnSync(process.env.WOSM_TMUX_BIN ?? "tmux", ["kill-session", "-t", devSessionName], {
    cwd: repoRoot,
    stdio: "ignore",
    env: process.env,
  });
}

function shellCommand(parts) {
  return parts.map(shellQuote).join(" ");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
