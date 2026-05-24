import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@wosm/cli";
import { describe, expect, it } from "vitest";

describe("CLI Codex hook commands", () => {
  it("plans Codex hook changes without applying them", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-codex-hooks-"));
    const configPath = await writeConfig(root, true);
    const codexConfigPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    const result = await runCli([
      "--config",
      configPath,
      "hooks",
      "plan",
      "codex",
      "--codex-config",
      codexConfigPath,
      "--hook-script",
      hookScriptPath,
    ]);

    expect(result).toMatchObject({
      code: 0,
      output: {
        provider: "codex",
        changed: true,
        configPath: codexConfigPath,
        hookScriptPath,
      },
    });
    await expect(readFile(codexConfigPath, "utf8")).rejects.toThrow();
    await expect(readFile(hookScriptPath, "utf8")).rejects.toThrow();
  });

  it("requires explicit confirmation before install", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-codex-hooks-"));
    const configPath = await writeConfig(root, true);

    await expect(runCli(["--config", configPath, "hooks", "install", "codex"])).rejects.toThrow(
      "without --yes",
    );
  });

  it("installs and uninstalls through the generic hooks command", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-codex-hooks-"));
    const configPath = await writeConfig(root, true);
    const codexConfigPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    const installed = await runCli([
      "--config",
      configPath,
      "hooks",
      "install",
      "codex",
      "--yes",
      "--codex-config",
      codexConfigPath,
      "--hook-script",
      hookScriptPath,
    ]);
    const uninstalled = await runCli([
      "--config",
      configPath,
      "hooks",
      "uninstall",
      "codex",
      "--yes",
      "--codex-config",
      codexConfigPath,
      "--hook-script",
      hookScriptPath,
    ]);

    expect(installed).toMatchObject({
      code: 0,
      output: {
        provider: "codex",
        installed: true,
      },
    });
    expect(uninstalled).toMatchObject({
      code: 0,
      output: {
        provider: "codex",
        installed: false,
      },
    });
  });

  it("warns on doctor only when install_hooks requested Codex hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-cli-codex-hooks-"));
    const requestedConfigPath = await writeConfig(join(root, "requested"), true);
    const passiveConfigPath = await writeConfig(join(root, "passive"), false);
    const codexConfigPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    const requested = await runCli([
      "--config",
      requestedConfigPath,
      "hooks",
      "doctor",
      "codex",
      "--codex-config",
      codexConfigPath,
      "--hook-script",
      hookScriptPath,
    ]);
    const passive = await runCli([
      "--config",
      passiveConfigPath,
      "hooks",
      "doctor",
      "codex",
      "--codex-config",
      codexConfigPath,
      "--hook-script",
      hookScriptPath,
    ]);

    expect(requested).toMatchObject({
      code: 1,
      output: {
        provider: "codex",
        status: "warn",
      },
    });
    expect(passive).toMatchObject({
      code: 0,
      output: {
        provider: "codex",
        status: "ok",
      },
    });
  });
});

async function writeConfig(root: string, installHooks: boolean): Promise<string> {
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
      "[harness.codex]",
      'command = "codex"',
      `install_hooks = ${installHooks ? "true" : "false"}`,
      "",
    ].join("\n"),
  );
  return configPath;
}
