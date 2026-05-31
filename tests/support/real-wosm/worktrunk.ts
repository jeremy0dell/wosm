import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WorktreeObservation } from "@wosm/contracts";
import type { RealWosmConfigFixture } from "./config";
import type { RealDogfoodEnvironment } from "./env";
import { requireToolPath } from "./env";
import type { RealTempRepo } from "./repo";

const execFileAsync = promisify(execFile);

export async function runWorktrunkJson<T = unknown>(input: {
  env: RealDogfoodEnvironment;
  config: RealWosmConfigFixture;
  repo: RealTempRepo;
  args: string[];
  envVars?: Record<string, string>;
  timeoutMs?: number;
}): Promise<T> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (input.envVars !== undefined) {
    for (const [key, value] of Object.entries(input.envVars)) {
      childEnv[key] = value;
    }
  }
  const output = await execFileAsync(
    requireToolPath(input.env, "worktrunk"),
    ["--config", input.config.worktrunkConfigPath, ...input.args],
    {
      cwd: input.repo.repoPath,
      env: childEnv,
      timeout: input.timeoutMs ?? 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(output.stdout) as T;
}

export async function listRealWorktrunkWorktrees(input: {
  env: RealDogfoodEnvironment;
  config: RealWosmConfigFixture;
  repo: RealTempRepo;
}): Promise<unknown> {
  return runWorktrunkJson({
    ...input,
    args: ["list", "--format=json"],
  });
}

export async function createRealWorktrunkWorktree(input: {
  env: RealDogfoodEnvironment;
  config: RealWosmConfigFixture;
  repo: RealTempRepo;
  branch: string;
}): Promise<unknown> {
  return runWorktrunkJson({
    env: input.env,
    config: input.config,
    repo: input.repo,
    args: [
      "switch",
      "--create",
      input.branch,
      "--base",
      input.repo.baseBranch,
      "--no-cd",
      "--format=json",
    ],
    envVars: {
      WORKTRUNK_WORKTREE_PATH: join(
        input.repo.repoPath,
        ".wosm-dogfood",
        "worktrees",
        "{{ branch | sanitize }}",
      ),
    },
    timeoutMs: 60_000,
  });
}

export async function removeRealWorktrunkWorktree(input: {
  env: RealDogfoodEnvironment;
  config: RealWosmConfigFixture;
  repo: RealTempRepo;
  branch: string;
}): Promise<void> {
  await execFileAsync(
    requireToolPath(input.env, "worktrunk"),
    [
      "--config",
      input.config.worktrunkConfigPath,
      "remove",
      input.branch,
      "--force",
      "--force-delete",
      "--foreground",
      "--format=json",
    ],
    {
      cwd: input.repo.repoPath,
      timeout: 60_000,
    },
  ).catch(() => undefined);
}

export function findWorktrunkObservation(
  value: unknown,
  branch: string,
): WorktreeObservation | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.find((item): item is WorktreeObservation => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    return "branch" in item && item.branch === branch;
  });
}
