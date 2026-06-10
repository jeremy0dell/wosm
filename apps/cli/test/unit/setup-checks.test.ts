import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { setupProbeTimeoutMs } from "../../src/commands/setup/checks/constants.js";
import { collectSetupFacts } from "../../src/commands/setup/checks/system.js";
import {
  checkSetupTmuxBinding,
  tmuxPopupBindingBlock,
} from "../../src/commands/setup/checks/tmuxBinding.js";
import { buildSetupPlan } from "../../src/commands/setup/planner.js";

describe("setup dependency checks", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("collects core facts through injected effects only", async () => {
    const root = await tempRoot(tempRoots);
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
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "/fake/bin/wt", timeoutMs: setupProbeTimeoutMs }),
        expect.objectContaining({ command: "/fake/bin/tmux", timeoutMs: setupProbeTimeoutMs }),
        expect.objectContaining({ command: "git", timeoutMs: setupProbeTimeoutMs }),
        expect.objectContaining({ command: "brew", timeoutMs: setupProbeTimeoutMs }),
        expect.objectContaining({ command: "codex", timeoutMs: setupProbeTimeoutMs }),
      ]),
    );
  });

  it("marks missing Worktrunk and tmux as required failures", async () => {
    const root = await tempRoot(tempRoots);
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
    const root = await tempRoot(tempRoots);
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
    const root = await tempRoot(tempRoots);
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
    const root = await tempRoot(tempRoots);
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

  it("treats invalid config as a required setup failure", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner([], {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        "codex --version": "codex 0.1.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({
        [join(root, "home/.config/wosm/config.toml")]: "schema_version = 1\n[defaults\n",
      }),
      noBrew: true,
    });
    const plan = buildSetupPlan(facts);

    expect(plan.summary.requiredOk).toBe(false);
    expect(plan.checks.find((check) => check.id === "config")).toMatchObject({
      status: "missing",
    });
  });

  it("fails readiness for existing config defaults outside the setup core path", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    const otherRepo = join(root, "other");
    await mkdir(repo, { recursive: true });
    await mkdir(otherRepo, { recursive: true });
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner([], {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        "codex --version": "codex 0.1.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({
        [join(root, "home/.config/wosm/config.toml")]: configToml(otherRepo, {
          worktreeProvider: "noop-worktree",
        }),
      }),
      noBrew: true,
    });
    const plan = buildSetupPlan(facts);

    expect(plan.summary.requiredOk).toBe(false);
    expect(plan.checks.find((check) => check.id === "config")?.message).toContain("noop-worktree");
  });

  it("fails readiness when an existing project uses an unsupported harness", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const facts = await collectSetupFacts({
      mode: "check",
      cwd: repo,
      homeDir: join(root, "home"),
      env: { PATH: "/fake/bin" },
      runner: fakeRunner([], {
        "git rev-parse --show-toplevel": repo,
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
        "wt --version": "worktrunk 1.2.3\n",
        "tmux -V": "tmux 3.5a\n",
        "codex --version": "codex 0.1.0\n",
      }),
      access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
      fs: readOnlyFs({
        [join(root, "home/.config/wosm/config.toml")]: configToml(repo, {
          harness: "missing-harness",
        }),
      }),
      noBrew: true,
    });
    const plan = buildSetupPlan(facts);

    expect(plan.summary.requiredOk).toBe(false);
    expect(plan.checks.find((check) => check.id === "config")?.message).toContain(
      "missing-harness",
    );
  });

  it("generates a tmux popup binding with tmux-format quoting for client names", () => {
    const binding = tmuxPopupBindingBlock();
    const clientNames = ["client one", "client'quote", "client;rm -rf", "client$(touch nope)"];

    expect(binding).toContain("WOSM_FOCUS_CLIENT_ID=#{q:client_name}");
    expect(binding).not.toContain('WOSM_FOCUS_CLIENT_ID="#{client_name}"');
    for (const clientName of clientNames) {
      expect(binding).not.toContain(clientName);
    }
  });

  it("reports old tmux popup bindings as missing when setup resolved a checkout launcher", async () => {
    const root = await tempRoot(tempRoots);
    const homeDir = join(root, "home");
    const binding = await checkSetupTmuxBinding({
      homeDir,
      launcherCommand: "/tmp/wosm/integrations/terminal/tmux/bin/wosm-popup",
      fs: readOnlyFs({
        [join(homeDir, ".tmux.conf")]: tmuxPopupBindingBlock(),
      }),
    });

    expect(binding).toMatchObject({
      status: "missing",
      message: "tmux popup binding is installed but uses an outdated WOSM launcher command.",
    });
  });
});

async function tempRoot(tempRoots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wosm-setup-checks-"));
  tempRoots.push(root);
  return root;
}

function fakeRunner(
  calls: ExternalCommandInput[],
  outputs: Record<string, string>,
): (input: ExternalCommandInput) => Promise<ExternalCommandResult> {
  return async (input) => {
    calls.push(input);
    const key = `${input.command} ${(input.args ?? []).join(" ")}`;
    const stdout = outputs[key] ?? fakeBinOutput(input, outputs);
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

function fakeBinOutput(
  input: ExternalCommandInput,
  outputs: Record<string, string>,
): string | undefined {
  if (!input.command.startsWith("/fake/bin/")) {
    return undefined;
  }
  return outputs[`${basename(input.command)} ${(input.args ?? []).join(" ")}`];
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

function configToml(
  repo: string,
  options: { worktreeProvider?: string; terminal?: string; harness?: string } = {},
): string {
  return [
    "schema_version = 1",
    "",
    "[observer]",
    'socket_path = "~/.local/state/wosm/observer.sock"',
    'state_dir = "~/.local/state/wosm"',
    "",
    "[defaults]",
    `worktree_provider = ${JSON.stringify(options.worktreeProvider ?? "worktrunk")}`,
    `terminal = ${JSON.stringify(options.terminal ?? "tmux")}`,
    `harness = ${JSON.stringify(options.harness ?? "codex")}`,
    'layout = "agent-shell"',
    "",
    "[[projects]]",
    'id = "repo"',
    'label = "repo"',
    `root = ${JSON.stringify(repo)}`,
    "",
  ].join("\n");
}
