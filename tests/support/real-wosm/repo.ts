import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RealDogfoodEnvironment } from "./env";

const execFileAsync = promisify(execFile);

export type RealTempRepo = {
  root: string;
  repoPath: string;
  dogfoodDir: string;
  baseBranch: string;
  cleanup(): Promise<void>;
};

export async function createRealTempRepo(env: RealDogfoodEnvironment): Promise<RealTempRepo> {
  const root = await mkdtemp(join(tmpdir(), "wosm-real-dogfood-"));
  const repoPath = join(root, "repo");
  const dogfoodDir = join(repoPath, ".wosm-dogfood");

  await execFileAsync(
    "git",
    ["clone", "--quiet", "--local", "--no-hardlinks", env.repoRoot, repoPath],
    {
      timeout: 60_000,
    },
  );
  await execFileAsync("git", ["config", "user.email", "wosm@example.invalid"], {
    cwd: repoPath,
    timeout: 10_000,
  });
  await execFileAsync("git", ["config", "user.name", "wosm real dogfood"], {
    cwd: repoPath,
    timeout: 10_000,
  });
  await mkdir(dogfoodDir, { recursive: true });

  const baseBranchOutput = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
    timeout: 10_000,
  });
  const baseBranch = baseBranchOutput.stdout.trim() || "HEAD";

  return {
    root,
    repoPath,
    dogfoodDir,
    baseBranch,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function uniqueBranch(prefix: string): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `wosm/${prefix}-${suffix}`;
}
