import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RealE2eRequirements = {
  worktrunk?: boolean;
  tmux?: boolean;
  codex?: boolean;
  pi?: boolean;
  opencode?: boolean;
};

export type RealE2eEnvironment = {
  repoRoot: string;
  wosmBin: string;
  wosmIngressBin: string;
  worktrunkBin?: string;
  tmuxBin?: string;
  codexBin?: string;
  piBin?: string;
  opencodeBin?: string;
};

export function realE2eEnabled(): boolean {
  return process.env.WOSM_REAL_E2E === "1";
}

export async function requireRealE2eEnvironment(
  requirements: RealE2eRequirements = {},
): Promise<RealE2eEnvironment> {
  if (!realE2eEnabled()) {
    throw new Error("Set WOSM_REAL_E2E=1 to run real E2E tests.");
  }

  const repoRoot = process.cwd();
  const wosmBin = join(repoRoot, "bin", "wosm");
  const wosmIngressBin = join(repoRoot, "bin", "wosm-ingress");
  await access(wosmBin);
  await access(wosmIngressBin);

  const env: RealE2eEnvironment = {
    repoRoot,
    wosmBin,
    wosmIngressBin,
  };

  if (requirements.worktrunk === true) {
    if (process.env.WOSM_REAL_WORKTRUNK !== "1") {
      throw new Error("Set WOSM_REAL_WORKTRUNK=1 to run real Worktrunk E2E tests.");
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
      throw new Error("Set WOSM_REAL_CODEX=1 to run real Codex E2E tests.");
    }
    const codexBin = process.env.WOSM_CODEX_BIN ?? "codex";
    await execFileAsync(codexBin, ["login", "status"], { timeout: 20_000 });
    env.codexBin = codexBin;
  }

  if (requirements.pi === true) {
    if (process.env.WOSM_REAL_PI !== "1") {
      throw new Error("Set WOSM_REAL_PI=1 to run real Pi E2E tests.");
    }
    const piBin = process.env.WOSM_PI_BIN ?? "pi";
    await execFileAsync(piBin, ["--version"], { timeout: 20_000 });
    env.piBin = piBin;
  }

  if (requirements.opencode === true) {
    if (process.env.WOSM_REAL_OPENCODE !== "1") {
      throw new Error("Set WOSM_REAL_OPENCODE=1 to run real OpenCode E2E tests.");
    }
    const opencodeBin = process.env.WOSM_OPENCODE_BIN ?? "opencode";
    await execFileAsync(opencodeBin, ["--version"], { timeout: 20_000 });
    env.opencodeBin = opencodeBin;
  }

  return env;
}

export function requireToolPath(
  env: RealE2eEnvironment,
  tool: "worktrunk" | "tmux" | "codex" | "pi" | "opencode",
): string {
  if (tool === "worktrunk" && env.worktrunkBin !== undefined) return env.worktrunkBin;
  if (tool === "tmux" && env.tmuxBin !== undefined) return env.tmuxBin;
  if (tool === "codex" && env.codexBin !== undefined) return env.codexBin;
  if (tool === "pi" && env.piBin !== undefined) return env.piBin;
  if (tool === "opencode" && env.opencodeBin !== undefined) return env.opencodeBin;
  throw new Error(`Real E2E environment is missing ${tool}.`);
}
