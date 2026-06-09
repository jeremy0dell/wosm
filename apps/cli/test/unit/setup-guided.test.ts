import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import { runSetupCommand, type SetupPromptAdapter } from "../../src/commands/setup/index.js";

describe("guided setup command", () => {
  it("writes config after accepted prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-guided-"));
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
        prompt: prompt({ confirms: [true, false] }),
        writeStdout: (chunk) => chunks.push(chunk),
        now: () => new Date("2026-06-08T12:00:00.000Z"),
      },
    );

    expect(result.code).toBe(0);
    const configPath = join(root, "home/.config/wosm/config.toml");
    expect(fs.files[configPath]).toContain("[[projects]]");
    expect(chunks.join("")).toContain("Core setup complete.");
  });

  it("declining config write produces no writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-guided-"));
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
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-guided-"));
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
        prompt: prompt({ confirms: [true, false], selects: ["opencode"] }),
        writeStdout: () => undefined,
      },
    );

    expect(fs.files[join(root, "home/.config/wosm/config.toml")]).toContain("[harness.opencode]");
  });

  it("stops without prompting for config when no harness is available", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-guided-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fs = fakeFs({});
    let confirms = 0;

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
          async confirm() {
            confirms += 1;
            return true;
          },
          async select() {
            return "codex";
          },
        },
        writeStdout: () => undefined,
      },
    );

    expect(result.code).toBe(1);
    expect(confirms).toBe(0);
    expect(Object.keys(fs.files)).toEqual([]);
  });
});

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
