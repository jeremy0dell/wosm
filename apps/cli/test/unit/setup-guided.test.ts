import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { runSetupCommand, type SetupPromptAdapter } from "../../src/commands/setup/index.js";

describe("guided setup command", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("writes config after accepted prompts", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const fs = fakeFs({});
    const chunks: string[] = [];

    const result = await runSetupCommand(
      [],
      {},
      {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: fakeRunner(calls, {
          "git rev-parse --show-toplevel": repo,
          "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
          "wt --version": "worktrunk 1.2.3\n",
          "tmux -V": "tmux 3.5a\n",
          "brew --version": "Homebrew 4.0.0\n",
          "codex --version": "codex 0.1.0\n",
        }),
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs,
        prompt: prompt({ confirms: [true, false, false] }),
        writeStdout: (chunk) => chunks.push(chunk),
        now: () => new Date("2026-06-08T12:00:00.000Z"),
      },
    );

    expect(result.code).toBe(0);
    const configPath = join(root, "home/.config/wosm/config.toml");
    expect(fs.files[configPath]).toContain("[[projects]]");
    expect(chunks.join("")).toContain(`Applying: Write WOSM config (${configPath})`);
    expect(chunks.join("")).toContain("Completed: Write WOSM config");
    expect(chunks.join("")).toContain("Core setup complete.");
  });

  it("runs Worktrunk shell integration non-interactively after the WOSM prompt", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const fs = fakeFs({});
    const chunks: string[] = [];

    const result = await runSetupCommand(
      [],
      {},
      {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: fakeRunner(calls, {
          "git rev-parse --show-toplevel": repo,
          "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
          "wt --version": "worktrunk 1.2.3\n",
          "tmux -V": "tmux 3.5a\n",
          "codex --version": "codex 0.1.0\n",
          "wt -y config shell install": "",
        }),
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs,
        prompt: prompt({ confirms: [true, true, false] }),
        writeStdout: (chunk) => chunks.push(chunk),
      },
    );

    expect(result.code).toBe(0);
    expect(calls.find((call) => call.command === "wt" && call.args?.[0] === "-y")).toMatchObject({
      args: ["-y", "config", "shell", "install"],
      stdio: "inherit",
    });
    expect(chunks.join("")).toContain("Running: wt -y config shell install");
    expect(chunks.join("")).toContain("Completed: Install Worktrunk shell integration");
  });

  it("declining config write produces no writes", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});

    const result = await runSetupCommand(
      [],
      {},
      {
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
        fs,
        prompt: prompt({ confirms: [false] }),
        writeStdout: () => undefined,
      },
    );

    expect(result.code).toBe(1);
    expect(Object.keys(fs.files)).toEqual([]);
  });

  it("selects among multiple available harnesses", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});

    await runSetupCommand(
      [],
      {},
      {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: fakeRunner([], {
          "git rev-parse --show-toplevel": repo,
          "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
          "wt --version": "worktrunk 1.2.3\n",
          "tmux -V": "tmux 3.5a\n",
          "codex --version": "codex 0.1.0\n",
          "opencode --version": "opencode 1.0.0\n",
        }),
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs,
        prompt: prompt({ confirms: [true, false, false], selects: ["opencode"] }),
        writeStdout: () => undefined,
      },
    );

    expect(fs.files[join(root, "home/.config/wosm/config.toml")]).toContain("[harness.opencode]");
  });

  it("installs the optional tmux popup binding when accepted", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});

    const result = await runSetupCommand(
      [],
      {},
      {
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
        fs,
        prompt: prompt({ confirms: [true, false, true] }),
        writeStdout: () => undefined,
      },
    );

    expect(result.code).toBe(0);
    expect(fs.files[join(root, "home/.tmux.conf")]).toContain("wosm-tmux-popup");
  });

  it("installs a selected agent CLI when no harness is available, then continues", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});
    const calls: ExternalCommandInput[] = [];
    const chunks: string[] = [];
    let codexInstalled = false;

    const result = await runSetupCommand(
      [],
      {},
      {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: async (input) => {
          calls.push(input);
          const key = `${input.command} ${(input.args ?? []).join(" ")}`;
          if (key === "sh -c curl -fsSL https://chatgpt.com/codex/install.sh | sh") {
            codexInstalled = true;
            return commandResult(input, "");
          }
          if (key === "codex --version" && codexInstalled) {
            return commandResult(input, "codex 0.1.0\n");
          }
          return fakeRunner([], {
            "git rev-parse --show-toplevel": repo,
            "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
            "wt --version": "worktrunk 1.2.3\n",
            "tmux -V": "tmux 3.5a\n",
          })(input);
        },
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs,
        prompt: prompt({ confirms: [true, false, false, false, true, false, false] }),
        writeStdout: (chunk) => chunks.push(chunk),
      },
    );

    expect(result.code).toBe(0);
    expect(calls.find((call) => call.command === "sh")).toMatchObject({
      args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
      stdio: "inherit",
    });
    expect(fs.files[join(root, "home/.config/wosm/config.toml")]).toContain("[harness.codex]");
    expect(chunks.join("")).toContain("No supported agent CLI is available.");
    expect(chunks.join("")).toContain("Running: sh -c");
  });

  it("closes prompts and writes nothing when harness install choices are declined", async () => {
    const root = await tempRoot(tempRoots);
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});
    const chunks: string[] = [];
    let closed = false;

    const result = await runSetupCommand(
      [],
      {},
      {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: fakeRunner([], {
          "git rev-parse --show-toplevel": repo,
          "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
          "wt --version": "worktrunk 1.2.3\n",
          "tmux -V": "tmux 3.5a\n",
        }),
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs,
        prompt: {
          ...prompt({ confirms: [false, false, false, false] }),
          close() {
            closed = true;
          },
        },
        writeStdout: (chunk) => chunks.push(chunk),
      },
    );

    expect(result.code).toBe(1);
    expect(closed).toBe(true);
    expect(Object.keys(fs.files)).toEqual([]);
    expect(chunks.join("")).toContain("No agent CLI was installed.");
  });
});

async function tempRoot(tempRoots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wosm-setup-guided-"));
  tempRoots.push(root);
  return root;
}

function prompt(input: { confirms: boolean[]; selects?: string[] }): SetupPromptAdapter {
  const confirms = [...input.confirms];
  const selects = [...(input.selects ?? [])];
  return {
    async confirm() {
      return confirms.shift() ?? false;
    },
    async select() {
      return selects.shift() ?? "codex";
    },
  };
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
    return commandResult(input, stdout);
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

function commandResult(input: ExternalCommandInput, stdout: string): ExternalCommandResult {
  return {
    command: input.command,
    args: input.args ?? [],
    stdout,
    stderr: "",
    exitCode: 0,
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

function fakeFs(initial: Record<string, string>) {
  const files = { ...initial };
  return {
    files,
    async mkdir() {
      return undefined;
    },
    async readFile(path: string) {
      const content = files[path];
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return content;
    },
    async writeFile(path: string, content: string) {
      files[path] = content;
    },
    async rename(from: string, to: string) {
      const content = files[from];
      if (content === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      files[to] = content;
      delete files[from];
    },
    async access(path: string) {
      if (files[path] === undefined) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
    },
  };
}
