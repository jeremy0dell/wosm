import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import { describe, expect, it } from "vitest";

describe("CLI event hook commands", () => {
  it("plans and installs the built-in turn completion notification hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-event-hooks-"));
    const configPath = await writeConfig(root);
    const env = await envWithFakeCommand(root, "wosm");

    const plan = await runCli([
      "--config",
      configPath,
      "hooks",
      "plan",
      "event",
      "notify-turn-completion",
    ]);

    expect(plan).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        hookId: "notify-agent-idle",
        changed: true,
        installed: false,
      },
    });
    await expect(readFile(configPath, "utf8")).resolves.not.toContain("notify-agent-idle");

    await expect(
      runCli(["--config", configPath, "hooks", "install", "event", "notify-turn-completion"]),
    ).rejects.toThrow("without --yes");

    const install = await runCli([
      "--config",
      configPath,
      "hooks",
      "install",
      "event",
      "notify-turn-completion",
      "--yes",
    ]);

    expect(install).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        installed: true,
      },
    });
    const after = await readFile(configPath, "utf8");
    expect(after).toContain('id = "notify-agent-idle"');
    expect(after).toContain('events = ["worktree.agentStateChanged"]');
    expect(after).toContain('command = "wosm"');
    expect(after).toContain('args = ["notify", "turn-completion"]');

    const doctor = await runCli(["--config", configPath, "hooks", "doctor", "event"], { env });
    expect(doctor).toMatchObject({
      code: 0,
      output: {
        provider: "event",
        status: "ok",
        installed: true,
        commandCheck: {
          status: "ok",
          command: "wosm notify turn-completion",
        },
      },
    });
  });

  it("warns when the installed notification command is stale or unusable", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-event-hooks-stale-"));
    const configPath = await writeConfig(root);
    const env = await envWithoutCommand(root);

    await runCli([
      "--config",
      configPath,
      "hooks",
      "install",
      "event",
      "notify-turn-completion",
      "--yes",
    ]);

    const doctor = await runCli(["--config", configPath, "hooks", "doctor", "event"], { env });

    expect(doctor).toMatchObject({
      code: 1,
      output: {
        provider: "event",
        status: "warn",
        installed: true,
        commandCheck: {
          status: "warn",
          command: "wosm notify turn-completion",
        },
      },
    });
  });
});

async function envWithFakeCommand(
  root: string,
  name: string,
): Promise<Record<string, string | undefined>> {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const executable = join(binDir, name);
  await writeFile(executable, ["#!/bin/sh", "exit 0", ""].join("\n"), "utf8");
  await chmod(executable, 0o755);
  return { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` };
}

async function envWithoutCommand(root: string): Promise<Record<string, string | undefined>> {
  const binDir = join(root, "empty-bin");
  await mkdir(binDir, { recursive: true });
  return { ...process.env, PATH: binDir };
}

async function writeConfig(root: string): Promise<string> {
  const configPath = join(root, "config.toml");
  await mkdir(join(root, "state"), { recursive: true });
  await writeFile(
    configPath,
    [
      "schema_version = 1",
      "projects = []",
      "",
      "[observer]",
      `socket_path = ${JSON.stringify(join(root, "run", "observer.sock"))}`,
      `state_dir = ${JSON.stringify(join(root, "state"))}`,
      "",
      "[defaults]",
      'worktree_provider = "worktrunk"',
      'terminal = "tmux"',
      'harness = "codex"',
      'layout = "agent-shell"',
      "",
    ].join("\n"),
    "utf8",
  );
  return configPath;
}
