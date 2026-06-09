import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { collectSetupFacts } from "../../src/commands/setup/checks/system.js";
import { buildSetupPlan } from "../../src/commands/setup/planner.js";

describe("setup dependency checks", () => {
  it("collects core facts through injected effects only", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const runner = fakeRunner(calls, {
      "git rev-parse --show-toplevel": repo,
      "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
      "wt --version": "worktrunk 1.2.3\n",
      "tmux -V": "tmux 3.5a\n",
      "brew --version": "Homebrew 4.0.0\n",
      "codex --version": "codex 0.1.0\n",
    });
    const fs = readOnlyFs({
      [join(root, "home/.config/wosm/config.toml")]: configToml(repo),
    });

    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner,
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs,
      now: () => new Date("2026-06-08T12:00:00.000Z"),
    });

    expect(facts.worktrunk).toMatchObject({ status: "ok", command: "wt", version: "1.2.3" });
    expect(facts.tmux).toMatchObject({ status: "ok", command: "tmux", version: "3.5a" });
    expect(facts.git).toMatchObject({ status: "ok", root: repo, defaultBranch: "main" });
    expect(facts.config).toMatchObject({ status: "valid", hasProjectForRoot: true });
    expect(facts.harnesses.find((harness) => harness.id === "codex")).toMatchObject({
      status: "ok",
      command: "codex",
    });
    expect(calls.map((call) => `${call.command} ${(call.args ?? []).join(" ")}`)).not.toContain(
      "gh --version",
    );
  });

  it("marks missing Worktrunk and tmux as required failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner(calls, {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "codex --version": "codex 0.1.0\n",
      }),
      access: fakeAccess([]),
      fs: readOnlyFs({}),
      now: () => new Date("2026-06-08T12:00:00.000Z"),
    });
    const plan = buildSetupPlan(facts);

    expect(plan.summary.requiredOk).toBe(false);
    expect(
      plan.checks.filter((check) => check.status === "missing").map((check) => check.id),
    ).toEqual(["worktrunk", "tmux", "config"]);
  });

  it("selects the first available harness from detection order", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const facts = await collectSetupFacts({
      mode: "plan",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner(calls, {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        "brew --version": "Homebrew 4.0.0\n",
        "agent --version": "cursor-agent 1.0.0\n",
        "opencode --version": "opencode 1.0.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({}),
      now: () => new Date("2026-06-08T12:00:00.000Z"),
    });
    const plan = buildSetupPlan(facts);

    expect(plan.summary.selectedHarness).toBe("cursor");
  });

  it("detects harness CLIs installed under the user local bin directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
    const repo = join(root, "repo");
    const home = join(root, "home");
    await mkdir(repo, { recursive: true });
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: home,
      env: { PATH: "/fake/bin" },
      runner: fakeRunner([], {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        [`${home}/.local/bin/agent --version`]: "cursor-agent 1.0.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({}),
      noBrew: true,
    });

    expect(facts.harnesses.find((harness) => harness.id === "cursor")).toMatchObject({
      status: "ok",
      command: `${home}/.local/bin/agent`,
    });
  });

  it("falls back to current branch and then main for git default branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner(calls, {
        "git rev-parse --show-toplevel": repo,
        "git rev-parse --abbrev-ref HEAD": "feature/setup\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        "codex --version": "codex 0.1.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({}),
      noBrew: true,
    });

    expect(facts.git).toMatchObject({ status: "ok", defaultBranch: "feature/setup" });
  });
});

function fakeRunner(
  calls: ExternalCommandInput[],
  outputs: Record<string, string>,
): (input: ExternalCommandInput) => Promise<ExternalCommandResult> {
  return async (input) => {
    calls.push(input);
    const key = `${input.command} ${(input.args ?? []).join(" ")}`;
    const stdout = outputs[key];
    if (stdout === undefined) {
      throw Object.assign(new Error(`missing fake command: ${key}`), { code: "ENOENT" });
    }
    return {
      command: input.command,
      args: input.args ?? [],
      stdout,
      stderr: "",
      exitCode: 0,
    };
  };
}

function fakeAccess(paths: readonly string[]): (path: string) => Promise<void> {
  const available = new Set(paths);
  return async (path) => {
    if (!available.has(path)) {
      throw Object.assign(new Error(`missing path: ${path}`), { code: "ENOENT" });
    }
  };
}

function readOnlyFs(files: Record<string, string>) {
  return {
    async readFile(path: string) {
      const source = files[path];
      if (source === undefined) {
        throw Object.assign(new Error(`missing file: ${path}`), { code: "ENOENT" });
      }
      return source;
    },
  };
}

function configToml(repo: string): string {
  return [
    "schema_version = 1",
    "",
    "[observer]",
    'socket_path = "~/.local/state/wosm/observer.sock"',
    'state_dir = "~/.local/state/wosm"',
    "",
    "[defaults]",
    'worktree_provider = "worktrunk"',
    'terminal = "tmux"',
    'harness = "codex"',
    'layout = "agent-shell"',
    "",
    "[[projects]]",
    'id = "repo"',
    'label = "repo"',
    `root = ${JSON.stringify(repo)}`,
    "",
  ].join("\n");
}
