#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = join(repoRoot, "apps/cli/dist/main.js");
const tuiWatchRunner = join(repoRoot, "scripts/tui-watch-runner.mjs");
const defaultDevSessionName = "_wosm-ui-dev";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runTuiDev();
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
}

export async function runTuiDev({ argv = process.argv.slice(2), env = process.env } = {}) {
  const devSessionName = env.WOSM_TUI_SESSION_NAME ?? defaultDevSessionName;
  const devTuiCommand =
    env.WOSM_TUI_COMMAND ?? shellCommand([process.execPath, tuiWatchRunner, cliEntry]);

  const logPath = join(repoRoot, ".turbo/tui-dev-build.log");
  await mkdir(dirname(logPath), { recursive: true });

  const initialBuild = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@wosm/cli", "--output-logs=errors-only"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env,
    },
  );
  if (initialBuild.status !== 0) {
    process.exit(initialBuild.status ?? 1);
  }

  const logFd = openSync(logPath, "a");
  let logOpen = true;
  const closeLog = () => {
    if (!logOpen) return;
    logOpen = false;
    closeSync(logFd);
  };

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
      env,
    },
  );

  const childEnv = {
    ...env,
    WOSM_TUI_COMMAND: devTuiCommand,
    WOSM_TUI_SESSION_NAME: devSessionName,
  };
  const runDirectTui = shouldRunDirectTui(argv, env);
  const keepAliveAfterLauncherExit = shouldKeepAliveAfterLauncherExit(argv, env);
  const nodeArgs = runDirectTui ? [tuiWatchRunner, cliEntry, ...argv] : [cliEntry, ...argv];

  process.stderr.write(`wosm:tui-dev build watcher: ${logPath}\n`);
  const wosm = spawn(process.execPath, nodeArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: childEnv,
  });

  let exiting = false;
  let launcherExited = false;
  const shutdown = (signal) => {
    if (exiting) return;
    exiting = true;
    buildWatcher.kill(signal);
    if (!launcherExited) {
      wosm.kill(signal);
    }
    cleanupDevUiSession(devSessionName, env);
    if (launcherExited) {
      closeLog();
      process.exitCode = 1;
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  buildWatcher.on("exit", (code, signal) => {
    if (exiting) {
      return;
    }
    exiting = true;
    if (!launcherExited) {
      wosm.kill("SIGTERM");
    }
    cleanupDevUiSession(devSessionName, env);
    closeLog();
    process.exitCode = signal === null ? (code ?? 1) : 1;
  });

  wosm.on("exit", (code, signal) => {
    launcherExited = true;
    if (keepAliveAfterLauncherExit && code === 0 && signal === null && !exiting) {
      process.stderr.write(
        "wosm:tui-dev popup launcher exited; build watcher remains active. Press Ctrl-C to stop.\n",
      );
      return;
    }
    if (!exiting) {
      exiting = true;
      buildWatcher.kill("SIGTERM");
      cleanupDevUiSession(devSessionName, env);
    }
    closeLog();
    if (signal !== null) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 0;
  });
}

export function commandFromArgs(argv) {
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

export function shouldRunDirectTui(argv, env) {
  const command = commandFromArgs(argv);
  return command === "tui" || (command === undefined && !isInsideTmux(env));
}

export function shouldKeepAliveAfterLauncherExit(argv, env) {
  const command = commandFromArgs(argv);
  return !shouldRunDirectTui(argv, env) && (command === undefined || command === "popup");
}

export function isInsideTmux(env) {
  const tmux = env.TMUX;
  return tmux !== undefined && tmux.length > 0;
}

function cleanupDevUiSession(devSessionName, env) {
  if (devSessionName !== defaultDevSessionName || !isInsideTmux(env)) {
    return;
  }
  spawnSync(env.WOSM_TMUX_BIN ?? "tmux", ["kill-session", "-t", devSessionName], {
    cwd: repoRoot,
    stdio: "ignore",
    env,
  });
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function shellCommand(parts) {
  return parts.map(shellQuote).join(" ");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
