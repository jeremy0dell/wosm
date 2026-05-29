import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installWorktrunkHooks, uninstallWorktrunkHooks, WorktrunkProvider } from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";
import { writeConfigToml } from "../support/temp-projects";

const execFileAsync = promisify(execFile);
const runReal = process.env.WOSM_REAL_WORKTRUNK === "1";
const describeReal = runReal ? describe : describe.skip;

describeReal("real Worktrunk provider smoke", () => {
  it("lists, creates, removes, and installs hooks against an isolated config", async () => {
    const wt = process.env.WOSM_WORKTRUNK_BIN ?? "wt";
    await execFileAsync(wt, ["--version"]);

    const root = await mkdtemp(join(tmpdir(), "wosm-real-wt-"));
    const repo = join(root, "repo");
    const worktrunkConfigPath = join(root, "worktrunk", "config.toml");
    const wosmIngressBin = join(process.cwd(), "bin", "wosm-ingress");
    const wosmConfigPath = await writeConfigToml(root, {
      schemaVersion: 1,
      observer: {
        stateDir: join(root, "wosm-state"),
        socketPath: join(root, "run", "observer.sock"),
        autoStartFromHooks: false,
      },
      defaults: {
        worktreeProvider: "noop-worktree",
        terminal: "noop-terminal",
        harness: "noop-harness",
        layout: "agent-shell",
      },
      projects: [],
    });
    const branch = `wosm-real-${Date.now()}`;
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
    await execFileAsync("git", ["config", "user.email", "wosm@example.invalid"], { cwd: repo });
    await execFileAsync("git", ["config", "user.name", "wosm"], { cwd: repo });
    await execFileAsync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: repo });

    const provider = new WorktrunkProvider({
      command: wt,
      configPath: worktrunkConfigPath,
      timeoutMs: 15000,
    });
    const project = {
      id: "real",
      label: "real",
      root: repo,
      defaults: {
        harness: "codex",
        terminal: "tmux",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
        base: "main",
      },
    };

    await installWorktrunkHooks({
      worktrunkConfigPath,
      wosmConfigPath,
      hookBin: wosmIngressBin,
    });

    let createdId: string | undefined;
    try {
      await expect(provider.health()).resolves.toMatchObject({ status: "healthy" });
      await expect(provider.listWorktrees(project)).resolves.toEqual(expect.any(Array));
      const created = await provider.createWorktree({ project, branch });
      createdId = created.id;
      expect(created.branch).toBe(branch);
      await expect(provider.removeWorktree({ worktreeId: created.id })).resolves.toMatchObject({
        removed: true,
      });
    } finally {
      if (createdId !== undefined) {
        await provider
          .removeWorktree({ worktreeId: createdId, force: true })
          .catch(() => undefined);
      }
      await uninstallWorktrunkHooks({
        worktrunkConfigPath,
        wosmConfigPath,
        hookBin: wosmIngressBin,
      }).catch(() => undefined);
    }
  });
});
