import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@wosm/config";
import { describe, expect, it } from "vitest";

describe("setup core flow e2e", () => {
  it("creates core config from a temp git repo without real external tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-e2e-"));
    let passed = false;
    try {
      const home = join(root, "home");
      const repo = join(root, "repo");
      const bin = join(root, "bin");
      const configPath = join(home, ".config", "wosm", "config.toml");
      await mkdir(home, { recursive: true });
      await mkdir(repo, { recursive: true });
      await mkdir(bin, { recursive: true });
      await writeShim(
        bin,
        "wt",
        'if [ "$1" = "--version" ]; then echo "worktrunk 1.2.3"; exit 0; fi\nexit 0\n',
      );
      await writeShim(
        bin,
        "tmux",
        'if [ "$1" = "-V" ]; then echo "tmux 3.5a"; exit 0; fi\nexit 0\n',
      );
      await writeShim(
        bin,
        "codex",
        'if [ "$1" = "--version" ]; then echo "codex 0.1.0"; exit 0; fi\nexit 0\n',
      );
      await writeShim(
        bin,
        "brew",
        'if [ "$1" = "--version" ]; then echo "Homebrew 4.0.0"; exit 0; fi\nexit 0\n',
      );
      run("git", ["init", "-b", "main"], { cwd: repo });

      const env = {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        WOSM_FAST_POPUP_NO_FALLBACK: "1",
      };
      const firstCheck = runWosm(["--config", configPath, "setup", "check", "--json"], {
        cwd: repo,
        env,
        allowFailure: true,
      });
      expect(firstCheck.status).toBe(1);
      const firstPlan = JSON.parse(firstCheck.stdout);
      expect(firstPlan.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "worktrunk", status: "ok" }),
          expect.objectContaining({ id: "tmux", status: "ok" }),
          expect.objectContaining({ id: "harness", status: "ok" }),
          expect.objectContaining({ id: "config", status: "missing" }),
        ]),
      );

      const plan = runWosm(["--config", configPath, "setup", "plan", "--json"], { cwd: repo, env });
      const parsedPlan = JSON.parse(plan.stdout);
      expect(parsedPlan.actions).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "write-config" })]),
      );
      expect(JSON.stringify(parsedPlan.actions)).not.toContain("github");

      const apply = runWosm(["--config", configPath, "setup", "apply", "--yes"], {
        cwd: repo,
        env,
      });
      expect(apply.stdout).toContain("Core setup complete.");
      await expect(readFile(configPath, "utf8")).resolves.toContain("[harness.codex]");

      const finalCheck = runWosm(["--config", configPath, "setup", "check", "--json"], {
        cwd: repo,
        env,
      });
      const finalPlan = JSON.parse(finalCheck.stdout);
      expect(finalPlan.summary.requiredOk).toBe(true);
      await expect(loadConfig({ configPath, homeDir: home })).resolves.toMatchObject({
        config: {
          defaults: {
            harness: "codex",
            terminal: "tmux",
            worktreeProvider: "worktrunk",
          },
        },
      });
      passed = true;
    } finally {
      if (passed || process.env.WOSM_KEEP_SETUP_E2E_TEMP !== "1") {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});

async function writeShim(bin: string, name: string, body: string): Promise<void> {
  const path = join(bin, name);
  await writeFile(path, `#!/bin/sh\n${body}`, "utf8");
  await chmod(path, 0o700);
}

function runWosm(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; allowFailure?: boolean },
): { stdout: string; stderr: string; status: number | null } {
  return run(join(process.cwd(), "bin", "wosm"), args, options);
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean },
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}
