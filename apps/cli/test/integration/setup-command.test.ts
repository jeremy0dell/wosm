import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { describe, expect, it } from "vitest";

describe("CLI setup command", () => {
  it("returns deterministic JSON for setup check without loading observer config", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-cli-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];

    const result = await runCli(
      ["--config", join(root, "missing.toml"), "setup", "check", "--json"],
      {
        setupDeps: {
          cwd: repo,
          homeDir: join(root, "home"),
          env: { PATH: "/fake/bin" },
          runner: fakeRunner(calls, {
            "git rev-parse --show-toplevel": repo,
            "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
            "wt --version": "worktrunk 1.2.3\n",
            "tmux -V": "tmux 3.5a\n",
            "codex --version": "codex 0.1.0\n",
          }),
          access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
          fs: readOnlyFs({}),
          now: () => new Date("2026-06-08T12:00:00.000Z"),
        },
      },
    );

    expect(result.code).toBe(1);
    expect(result.output).toMatchObject({
      generatedAt: "2026-06-08T12:00:00.000Z",
      mode: "check",
      summary: {
        requiredOk: false,
        selectedHarness: "codex",
        configPath: join(root, "missing.toml"),
      },
    });
    expect(calls.map((call) => call.command)).not.toContain("gh");
  });

  it("setup plan is read-only and includes a config write action", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-cli-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const chunks: string[] = [];

    const result = await runCli(["--config", join(root, "config.toml"), "setup", "plan"], {
      setupDeps: {
        cwd: repo,
        homeDir: join(root, "home"),
        env: { PATH: "/fake/bin" },
        runner: fakeRunner([], {
          "git rev-parse --show-toplevel": repo,
          "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/main\n",
          "wt --version": "worktrunk 1.2.3\n",
          "tmux -V": "tmux 3.5a\n",
          "brew --version": "Homebrew 4.0.0\n",
          "codex --version": "codex 0.1.0\n",
        }),
        access: fakeAccess(["/fake/bin/wt", "/fake/bin/tmux"]),
        fs: readOnlyFs({}),
        writeStdout: (chunk) => chunks.push(chunk),
      },
    });

    expect(result).toEqual({ code: 0 });
    expect(chunks.join("")).toContain("Write WOSM config");
  });

  it("setup apply --dry-run performs no writes or external installs", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-setup-cli-"));
    const repo = join(root, "repo");
    await mkdir(repo, { recursive: true });
    const calls: ExternalCommandInput[] = [];
    const fs = fakeFs({});

    const result = await runCli(
      ["--config", join(root, "config.toml"), "setup", "apply", "--dry-run"],
      {
        setupDeps: {
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
          writeStdout: () => undefined,
        },
      },
    );

    expect(result.code).toBe(0);
    expect(Object.keys(fs.files)).toEqual([]);
    expect(calls.some((call) => call.command === "brew" && call.args?.[0] === "install")).toBe(
      false,
    );
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
      if (source === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return source;
    },
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
      if (files[path] === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  };
}
