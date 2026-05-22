import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RealDogfoodEnvironment } from "./env";
import { requireToolPath } from "./env";

const execFileAsync = promisify(execFile);

export async function killTmuxSession(
  env: RealDogfoodEnvironment,
  sessionName: string,
): Promise<void> {
  await execFileAsync(requireToolPath(env, "tmux"), ["kill-session", "-t", sessionName], {
    timeout: 10_000,
  }).catch(() => undefined);
}

export async function tmuxSessionExists(
  env: RealDogfoodEnvironment,
  sessionName: string,
): Promise<boolean> {
  try {
    await execFileAsync(requireToolPath(env, "tmux"), ["has-session", "-t", sessionName], {
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listTmuxWindows(
  env: RealDogfoodEnvironment,
  sessionName: string,
): Promise<string[]> {
  const output = await execFileAsync(
    requireToolPath(env, "tmux"),
    ["list-windows", "-t", sessionName, "-F", "#{window_name}"],
    { timeout: 10_000 },
  );
  return output.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function activeTmuxWindow(
  env: RealDogfoodEnvironment,
  sessionName: string,
): Promise<string> {
  const output = await execFileAsync(
    requireToolPath(env, "tmux"),
    ["display-message", "-p", "-t", sessionName, "#{window_name}"],
    { timeout: 10_000 },
  );
  return output.stdout.trim();
}

export async function startWosmTuiInTmux(input: {
  env: RealDogfoodEnvironment;
  configPath: string;
  sessionName: string;
}): Promise<void> {
  const command = [
    shellQuote(input.env.wosmBin),
    "--config",
    shellQuote(input.configPath),
    "tui",
  ].join(" ");
  await execFileAsync(
    requireToolPath(input.env, "tmux"),
    ["new-session", "-d", "-s", input.sessionName, command],
    { timeout: 10_000 },
  );
}

export async function sendTmuxKeys(input: {
  env: RealDogfoodEnvironment;
  target: string;
  keys: string[];
}): Promise<void> {
  await execFileAsync(
    requireToolPath(input.env, "tmux"),
    ["send-keys", "-t", input.target, ...input.keys],
    {
      timeout: 10_000,
    },
  );
}

export async function captureTmuxPane(input: {
  env: RealDogfoodEnvironment;
  target: string;
}): Promise<string> {
  const output = await execFileAsync(
    requireToolPath(input.env, "tmux"),
    ["capture-pane", "-p", "-t", input.target, "-S", "-80"],
    { timeout: 10_000 },
  );
  return output.stdout;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
