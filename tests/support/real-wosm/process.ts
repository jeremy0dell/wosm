import { spawn } from "node:child_process";
import type { RealE2eEnvironment } from "./env";

export type WosmProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunWosmOptions = {
  configPath?: string;
  args: string[];
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export class CleanupStack {
  readonly #tasks: Array<() => Promise<void>> = [];

  defer(task: () => Promise<void>): void {
    this.#tasks.push(task);
  }

  async run(): Promise<void> {
    if (process.env.WOSM_REAL_E2E_KEEP_TEMP === "1") {
      process.stderr.write("WOSM_REAL_E2E_KEEP_TEMP=1; skipping real E2E cleanup.\n");
      return;
    }
    const tasks = this.#tasks.splice(0).reverse();
    const failures: unknown[] = [];
    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Real E2E cleanup failed.");
    }
  }
}

export async function runWosm(
  env: RealE2eEnvironment,
  options: RunWosmOptions,
): Promise<WosmProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const args =
    options.configPath === undefined
      ? options.args
      : ["--config", options.configPath, ...options.args];
  const childEnv = wosmChildEnv(env);
  if (options.env !== undefined) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value === undefined) {
        delete childEnv[key];
      } else {
        childEnv[key] = value;
      }
    }
  }

  return new Promise((resolve) => {
    const child = spawn(env.wosmBin, args, {
      cwd: options.cwd ?? env.repoRoot,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export async function runWosmJson<T = unknown>(
  env: RealE2eEnvironment,
  options: RunWosmOptions,
): Promise<T> {
  const result = await runWosm(env, options);
  if (result.timedOut) {
    throw new Error(`wosm ${options.args.join(" ")} timed out.\n${result.stderr}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `wosm ${options.args.join(" ")} exited ${result.exitCode}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (cause) {
    throw new Error(`wosm ${options.args.join(" ")} did not print valid JSON.`, { cause });
  }
}

function wosmChildEnv(env: RealE2eEnvironment): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env.worktrunkBin !== undefined) childEnv.WOSM_WORKTRUNK_BIN = env.worktrunkBin;
  if (env.tmuxBin !== undefined) childEnv.WOSM_TMUX_BIN = env.tmuxBin;
  if (env.codexBin !== undefined) childEnv.WOSM_CODEX_BIN = env.codexBin;
  if (env.piBin !== undefined) childEnv.WOSM_PI_BIN = env.piBin;
  if (env.opencodeBin !== undefined) childEnv.WOSM_OPENCODE_BIN = env.opencodeBin;
  return childEnv;
}
