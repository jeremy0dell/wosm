import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFromToml } from "@wosm/config";
import { afterEach, describe, expect, it } from "vitest";
import { planSetupConfigWrite } from "../../src/commands/setup/configWriter.js";
import type { SetupFacts } from "../../src/commands/setup/model.js";

describe("setup config writer", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("generates new config TOML that parses through the config loader", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const facts = setupFacts(repo, {
      config: {
        status: "missing",
        path: join(root, "config.toml"),
        message: "missing",
      },
    });

    const write = await planSetupConfigWrite(facts);

    expect(write.operation).toBe("create");
    if (write.operation !== "create") throw new Error("expected create plan");
    const loaded = await loadConfigFromToml(write.content, {
      configPath: write.path,
      homeDir: root,
    });
    expect(loaded.config.defaults).toMatchObject({
      worktreeProvider: "worktrunk",
      terminal: "tmux",
      harness: "codex",
      defaultBranch: "main",
    });
    expect(loaded.config.projects[0]).toMatchObject({
      id: "repo",
      root: repo,
    });
  });

  it("appends only missing project and harness blocks to a valid existing config", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    const otherRepo = join(root, "other");
    await mkdir(repo, { recursive: true });
    await mkdir(otherRepo, { recursive: true });
    const source = existingConfigToml(root, { projectRoot: otherRepo });
    const facts = setupFacts(repo, {
      config: {
        status: "valid",
        path: join(root, "config.toml"),
        source,
        hasProjectForRoot: false,
        configuredHarnesses: [],
        defaults: {
          worktreeProvider: "worktrunk",
          terminal: "tmux",
          harness: "codex",
        },
      },
    });

    const write = await planSetupConfigWrite(facts);

    expect(write).toMatchObject({
      operation: "append",
      path: join(root, "config.toml"),
    });
    if (write.operation !== "append") throw new Error("expected append plan");
    expect(write.content.startsWith(source.trimEnd())).toBe(true);
    expect(write.appendedText).toContain("[harness.codex]");
    expect(write.appendedText).toContain("[[projects]]");
    expect(write.appendedText).not.toContain("[defaults]");
  });

  it("does not plan broad rewrites for an already-covered config", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const source = existingConfigToml(root, { projectRoot: repo, includeHarness: true });
    const facts = setupFacts(repo, {
      config: {
        status: "valid",
        path: join(root, "config.toml"),
        source,
        hasProjectForRoot: true,
        configuredHarnesses: ["codex"],
        defaults: {
          worktreeProvider: "worktrunk",
          terminal: "tmux",
          harness: "codex",
        },
        matchedProject: {
          id: "repo",
          worktreeProvider: "worktrunk",
          worktrunkEnabled: true,
          terminal: "tmux",
          harness: "codex",
        },
      },
    });

    await expect(planSetupConfigWrite(facts)).resolves.toEqual({
      operation: "none",
      reason: "Config already includes this repository and selected harness.",
    });
  });

  it("blocks invalid existing config without a write action", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const facts = setupFacts(repo, {
      config: {
        status: "invalid",
        path: join(root, "config.toml"),
        source: "schema_version = 1\n[defaults\n",
        message: "WOSM config file is not valid TOML.",
      },
    });

    await expect(planSetupConfigWrite(facts)).resolves.toEqual({
      operation: "blocked",
      path: join(root, "config.toml"),
      reason: "WOSM config file is not valid TOML.",
    });
  });

  it("preserves custom detected Worktrunk and tmux commands in new config", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const facts = setupFacts(repo, {
      worktrunk: {
        status: "ok",
        command: "/custom/bin/wt",
        resolvedPath: "/custom/bin/wt",
      },
      tmux: {
        status: "ok",
        command: "/custom/bin/tmux",
        resolvedPath: "/custom/bin/tmux",
      },
      config: {
        status: "missing",
        path: join(root, "config.toml"),
        message: "missing",
      },
    });

    const write = await planSetupConfigWrite(facts);

    expect(write.operation).toBe("create");
    if (write.operation !== "create") throw new Error("expected create plan");
    expect(write.content).toContain('command = "/custom/bin/wt"');
    expect(write.content).toContain('[terminal.tmux]\ncommand = "/custom/bin/tmux"');
  });

  it("blocks appending a project that would inherit non-core defaults", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    const otherRepo = join(root, "other");
    await mkdir(repo, { recursive: true });
    await mkdir(otherRepo, { recursive: true });
    const source = existingConfigToml(root, { projectRoot: otherRepo });
    const facts = setupFacts(repo, {
      config: {
        status: "valid",
        path: join(root, "config.toml"),
        source,
        hasProjectForRoot: false,
        configuredHarnesses: ["codex"],
        defaults: {
          worktreeProvider: "noop-worktree",
          terminal: "tmux",
          harness: "codex",
        },
      },
    });

    await expect(planSetupConfigWrite(facts)).resolves.toMatchObject({
      operation: "blocked",
      reason: expect.stringContaining("noop-worktree"),
    });
  });
});

async function tempRoot(tempRoots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wosm-setup-config-"));
  tempRoots.push(root);
  return root;
}

function setupFacts(repo: string, overrides: Partial<SetupFacts>): SetupFacts {
  return {
    generatedAt: "2026-06-08T12:00:00.000Z",
    mode: "plan",
    configPath: "/tmp/config.toml",
    homeDir: "/tmp/home",
    worktrunk: { status: "ok", command: "wt" },
    tmux: { status: "ok", command: "tmux" },
    brew: { status: "ok", command: "brew" },
    git: {
      status: "ok",
      root: repo,
      repoName: "repo",
      defaultBranch: "main",
    },
    harnesses: [
      { id: "codex", label: "Codex", status: "ok", command: "codex" },
      { id: "cursor", label: "Cursor Agent", status: "missing", command: "agent" },
      { id: "opencode", label: "OpenCode", status: "missing", command: "opencode" },
      { id: "pi", label: "Pi", status: "missing", command: "pi" },
    ],
    config: {
      status: "missing",
      path: "/tmp/config.toml",
      message: "missing",
    },
    tmuxBinding: {
      status: "missing",
      path: "/tmp/home/.tmux.conf",
      marker: "# >>> wosm popup binding >>>",
      message: "Optional tmux popup binding is not installed.",
    },
    ...overrides,
  };
}

function existingConfigToml(
  root: string,
  options: { projectRoot?: string; includeHarness?: boolean } = {},
): string {
  return [
    "schema_version = 1",
    "",
    "[observer]",
    `socket_path = ${JSON.stringify(join(root, "observer.sock"))}`,
    `state_dir = ${JSON.stringify(join(root, "state"))}`,
    "",
    "[defaults]",
    'worktree_provider = "worktrunk"',
    'terminal = "tmux"',
    'harness = "codex"',
    'layout = "agent-shell"',
    "",
    "[worktree.worktrunk]",
    'managed_root = "~/.worktrees"',
    "",
    ...(options.includeHarness === true
      ? ["[harness.codex]", "enabled = true", 'command = "codex"', ""]
      : []),
    ...(options.projectRoot === undefined
      ? []
      : [
          "[[projects]]",
          `id = ${JSON.stringify(options.projectRoot.endsWith("/other") ? "other" : "repo")}`,
          `label = ${JSON.stringify(options.projectRoot.endsWith("/other") ? "other" : "repo")}`,
          `root = ${JSON.stringify(options.projectRoot)}`,
          "",
        ]),
  ].join("\n");
}
