import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  doctorCodexHooks,
  installCodexHooks,
  planCodexHooks,
  uninstallCodexHooks,
} from "../../src/hooks";

describe("Codex hook setup", () => {
  it("plans hook config and generated script without writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    const plan = await planCodexHooks({
      codexConfigPath: configPath,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      hookBin: "/usr/local/bin/wosm-hook",
    });

    expect(plan.changed).toBe(true);
    expect(plan.missing).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop",
      "Stop",
    ]);
    expect(plan.commands.PreToolUse).toBe(hookScriptPath);
    expect(plan.after).toContain("[[hooks.PreToolUse]]");
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
    await expect(readFile(hookScriptPath, "utf8")).rejects.toThrow();
  });

  it("installs idempotently, backs up config, writes a script, and preserves unrelated hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(configPath, existingCodexConfig(), "utf8");

    const installed = await installCodexHooks({
      codexConfigPath: configPath,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
    });
    const second = await installCodexHooks({
      codexConfigPath: configPath,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
    });
    const config = await readFile(configPath, "utf8");
    const script = await readFile(hookScriptPath, "utf8");
    const scriptMode = (await stat(hookScriptPath)).mode & 0o777;

    expect(installed.backupPath).toBeDefined();
    expect(second.changed).toBe(false);
    expect(config).toContain("echo existing");
    expect(config).toContain(hookScriptPath);
    expect(script).toContain("wosm-hook --config /tmp/wosm/config.toml codex");
    expect(script).not.toContain(" hook codex");
    expect(script).toContain("--config /tmp/wosm/config.toml");
    expect(script).toContain('"$event" < "$payload_file" > /dev/null');
    expect(scriptMode).toBe(0o700);
    await expect(
      doctorCodexHooks({
        codexConfigPath: configPath,
        hookScriptPath,
        wosmConfigPath: "/tmp/wosm/config.toml",
        enabled: true,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      installed: true,
    });
  });

  it("can generate the legacy wosm hook command for compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    await installCodexHooks({
      codexConfigPath: configPath,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      wosmBin: "/usr/local/bin/wosm",
    });

    const script = await readFile(hookScriptPath, "utf8");
    expect(script).toContain("/usr/local/bin/wosm --config /tmp/wosm/config.toml hook codex");
  });

  it("uninstalls generated hooks without removing unrelated commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(configPath, existingCodexConfig(), "utf8");
    await installCodexHooks({ codexConfigPath: configPath, hookScriptPath });

    const removed = await uninstallCodexHooks({ codexConfigPath: configPath, hookScriptPath });
    const config = await readFile(configPath, "utf8");

    expect(removed.installed).toBe(false);
    expect(removed.scriptRemoved).toBe(true);
    expect(config).toContain("echo existing");
    expect(config).not.toContain(hookScriptPath);
    await expect(access(hookScriptPath)).rejects.toThrow();
  });

  it("only warns for missing hooks when install_hooks requested them", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    const hookScriptPath = join(root, "state", "hooks", "wosm-codex-hook.sh");

    await expect(
      doctorCodexHooks({ codexConfigPath: configPath, hookScriptPath, enabled: false }),
    ).resolves.toMatchObject({
      status: "ok",
      installed: false,
    });
    await expect(
      doctorCodexHooks({ codexConfigPath: configPath, hookScriptPath, enabled: true }),
    ).resolves.toMatchObject({
      status: "warn",
      installed: false,
    });
  });

  it("maps invalid Codex TOML to a typed setup error", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-codex-hooks-"));
    const configPath = join(root, "codex", "config.toml");
    await mkdir(join(root, "codex"), { recursive: true });
    await writeFile(configPath, "not = [valid");

    await expect(planCodexHooks({ codexConfigPath: configPath })).rejects.toMatchObject({
      tag: "CodexHookSetupError",
      code: "CODEX_HOOK_INVALID_TOML",
      provider: "codex",
    });
  });
});

function existingCodexConfig(): string {
  return [
    "[features]",
    "hooks = true",
    "",
    "[[hooks.PostToolUse]]",
    'matcher = ".*"',
    "[[hooks.PostToolUse.hooks]]",
    'type = "command"',
    'command = "echo existing"',
    "timeout = 10",
    "",
  ].join("\n");
}
