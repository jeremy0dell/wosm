import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RealDogfoodRequirements = {
  worktrunk?: boolean;
  tmux?: boolean;
  codex?: boolean;
  pi?: boolean;
};

export type RealDogfoodEnvironment = {
  repoRoot: string;
  wosmBin: string;
  wosmHookBin: string;
  worktrunkBin?: string;
  tmuxBin?: string;
  codexBin?: string;
  piBin?: string;
};

export function realDogfoodEnabled(): boolean {
  return process.env.WOSM_REAL_DOGFOOD === "1";
}

export async function requireRealDogfoodEnvironment(
  requirements: RealDogfoodRequirements = {},
): Promise<RealDogfoodEnvironment> {
  if (!realDogfoodEnabled()) {
    throw new Error("Set WOSM_REAL_DOGFOOD=1 to run real dogfood E2E tests.");
  }

  const repoRoot = process.cwd();
  const wosmBin = join(repoRoot, "bin", "wosm");
  const wosmHookBin = join(repoRoot, "bin", "wosm-hook");
  await access(wosmBin);
  await access(wosmHookBin);

  const env: RealDogfoodEnvironment = {
    repoRoot,
    wosmBin,
    wosmHookBin,
  };

  if (requirements.worktrunk === true) {
    if (process.env.WOSM_REAL_WORKTRUNK !== "1") {
      throw new Error("Set WOSM_REAL_WORKTRUNK=1 to run real Worktrunk dogfood tests.");
    }
    const worktrunkBin = process.env.WOSM_WORKTRUNK_BIN ?? "wt";
    await execFileAsync(worktrunkBin, ["--version"], { timeout: 15_000 });
    env.worktrunkBin = worktrunkBin;
  }

  if (requirements.tmux === true) {
    const tmuxBin = process.env.WOSM_TMUX_BIN ?? "tmux";
    await execFileAsync(tmuxBin, ["-V"], { timeout: 10_000 });
    env.tmuxBin = tmuxBin;
  }

  if (requirements.codex === true) {
    if (process.env.WOSM_REAL_CODEX !== "1") {
      throw new Error("Set WOSM_REAL_CODEX=1 to run real Codex dogfood tests.");
    }
    const codexBin = process.env.WOSM_CODEX_BIN ?? "codex";
    await execFileAsync(codexBin, ["login", "status"], { timeout: 20_000 });
    env.codexBin = codexBin;
  }

  if (requirements.pi === true) {
    if (process.env.WOSM_REAL_PI !== "1") {
      throw new Error("Set WOSM_REAL_PI=1 to run real Pi dogfood tests.");
    }
    const piBin = process.env.WOSM_PI_BIN ?? "pi";
    await execFileAsync(piBin, ["--version"], { timeout: 20_000 });
    env.piBin = piBin;
  }

  return env;
}

export function requireToolPath(
  env: RealDogfoodEnvironment,
  tool: "worktrunk" | "tmux" | "codex" | "pi",
): string {
  if (tool === "worktrunk" && env.worktrunkBin !== undefined) return env.worktrunkBin;
  if (tool === "tmux" && env.tmuxBin !== undefined) return env.tmuxBin;
  if (tool === "codex" && env.codexBin !== undefined) return env.codexBin;
  if (tool === "pi" && env.piBin !== undefined) return env.piBin;
  throw new Error(`Real dogfood environment is missing ${tool}.`);
}
