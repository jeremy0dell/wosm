import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  doctorClaudeHooks,
  installClaudeHooks,
  planClaudeHooks,
  uninstallClaudeHooks,
} from "../../src/hooks";

const expectedEvents = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "PreCompact",
  "Stop",
  "SessionEnd",
];

describe("Claude hook setup", () => {
  it("plans the settings artifact and generated script without writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const claudeConfigDir = join(root, "claude-home");
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const hookScriptPath = join(root, "state", "hooks", "wosm-claude-hook.sh");

    const plan = await planClaudeHooks({
      claudeSettingsPath: settingsPath,
      claudeConfigDir,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
      hookBin: "/usr/local/bin/wosm-ingress",
      env: {},
    });

    expect(plan.changed).toBe(true);
    expect(plan.settingsPath).toBe(settingsPath);
    expect(plan.userSettingsPath).toBe(join(claudeConfigDir, "settings.json"));
    expect(plan.hookScriptPath).toBe(hookScriptPath);
    expect(plan.missing).toEqual(expectedEvents);
    expect(plan.settingsChanged).toBe(true);
    expect(plan.scriptChanged).toBe(true);
    expect(plan.artifactInvalid).toBe(false);
    await expect(access(settingsPath)).rejects.toThrow();
    await expect(access(hookScriptPath)).rejects.toThrow();

    const settings = JSON.parse(plan.after) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    };
    expect(Object.keys(settings.hooks)).toEqual(expectedEvents);
    for (const entries of Object.values(settings.hooks)) {
      expect(entries).toHaveLength(1);
      expect(entries[0]?.hooks[0]).toMatchObject({
        type: "command",
        command: hookScriptPath,
        timeout: 30,
        statusMessage: "Notify wosm",
      });
    }
    expect(settings.hooks.PreToolUse?.[0]?.matcher).toBe("*");
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe("*");
    expect(settings.hooks.Stop?.[0]).not.toHaveProperty("matcher");
  });

  it("installs the artifact and script idempotently with the env guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const claudeConfigDir = join(root, "claude-home");
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const hookScriptPath = join(root, "state", "hooks", "wosm-claude-hook.sh");
    const options = {
      claudeSettingsPath: settingsPath,
      claudeConfigDir,
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
      env: {},
    };

    const first = await installClaudeHooks(options);
    const second = await installClaudeHooks(options);
    const script = await readFile(hookScriptPath, "utf8");
    const scriptMode = (await stat(hookScriptPath)).mode & 0o777;
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: Record<string, unknown>;
    };

    expect(first.installed).toBe(true);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(Object.keys(settings.hooks)).toEqual(expectedEvents);
    expect(script).toContain(
      `if [ -z "\${WOSM_SESSION_ID:-}" ] || [ -z "\${WOSM_WORKTREE_ID:-}" ]; then`,
    );
    expect(script).toContain("--config /tmp/wosm/config.toml");
    expect(script).toContain("claude > /dev/null");
    expect(script).not.toContain("payload_file=");
    expect(scriptMode).toBe(0o700);
    await expect(doctorClaudeHooks({ ...options, enabled: true })).resolves.toMatchObject({
      status: "ok",
      installed: true,
      settingsPath,
    });
  });

  it("generated script exits before payload parsing or hook invocation without ownership env", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const hookScriptPath = join(root, "state", "hooks", "wosm-claude-hook.sh");

    await installClaudeHooks({
      claudeSettingsPath: settingsPath,
      claudeConfigDir: join(root, "claude-home"),
      hookScriptPath,
      hookBin: join(root, "missing-wosm-ingress"),
      env: {},
    });

    for (const env of [
      {},
      { WOSM_SESSION_ID: "ses_web_task" },
      { WOSM_WORKTREE_ID: "wt_web_task" },
    ]) {
      const result = await runHookScript(hookScriptPath, "{ invalid json", {
        TMPDIR: root,
        ...env,
      });

      expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });

  it("generated script invokes wosm-ingress with Claude stdin when ownership env is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const hookScriptPath = join(root, "state", "hooks", "wosm-claude-hook.sh");
    const hookBin = join(root, "wosm-ingress");
    const argsLog = join(root, "hook.args");
    const stdinLog = join(root, "hook.stdin");
    await writeFile(
      hookBin,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s\\n' "$*" >> ${shellQuote(argsLog)}`,
        `cat >> ${shellQuote(stdinLog)}`,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );

    await installClaudeHooks({
      claudeSettingsPath: settingsPath,
      claudeConfigDir: join(root, "claude-home"),
      hookScriptPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      hookBin,
      env: {},
    });

    const payload = JSON.stringify({ hook_event_name: "PreToolUse" });
    const result = await runHookScript(hookScriptPath, payload, {
      TMPDIR: root,
      WOSM_SESSION_ID: "ses_web_task",
      WOSM_WORKTREE_ID: "wt_web_task",
    });

    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
    await expect(readFile(argsLog, "utf8")).resolves.toBe(
      "--config /tmp/wosm/config.toml claude\n",
    );
    await expect(readFile(stdinLog, "utf8")).resolves.toBe(payload);
  });

  it("uninstalls wosm artifacts and cleans generated entries from user settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const claudeConfigDir = join(root, "claude-home");
    const userSettingsPath = join(claudeConfigDir, "settings.json");
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const hookScriptPath = join(root, "state", "hooks", "wosm-claude-hook.sh");
    const options = {
      claudeSettingsPath: settingsPath,
      claudeConfigDir,
      hookScriptPath,
      env: {},
    };
    await installClaudeHooks(options);
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(userSettingsPath, userSettingsWithGeneratedEntries(hookScriptPath), "utf8");

    const removed = await uninstallClaudeHooks(options);
    const userSettings = await readFile(userSettingsPath, "utf8");

    expect(removed.installed).toBe(false);
    expect(removed.settingsRemoved).toBe(true);
    expect(removed.scriptRemoved).toBe(true);
    expect(removed.userSettingsCleanup.changed).toBe(true);
    expect(removed.userSettingsCleanup.stale).toEqual(["SessionStart", "Stop"]);
    expect(userSettings).toContain("my-own-hook.sh");
    expect(userSettings).toContain('"theme": "dark"');
    expect(userSettings).not.toContain("wosm-claude-hook.sh");
    await expect(access(settingsPath)).rejects.toThrow();
    await expect(access(hookScriptPath)).rejects.toThrow();
  });

  it("only warns for missing hooks when install_hooks requested them", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const options = {
      claudeSettingsPath: join(root, "state", "hooks", "wosm-claude-settings.json"),
      claudeConfigDir: join(root, "claude-home"),
      hookScriptPath: join(root, "state", "hooks", "wosm-claude-hook.sh"),
      env: {},
    };

    await expect(doctorClaudeHooks({ ...options, enabled: false })).resolves.toMatchObject({
      status: "ok",
      installed: false,
    });
    await expect(doctorClaudeHooks({ ...options, enabled: true })).resolves.toMatchObject({
      status: "warn",
      installed: false,
    });
  });

  it("warns when the settings artifact is invalid JSON instead of erroring", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-claude-hooks-"));
    const settingsPath = join(root, "state", "hooks", "wosm-claude-settings.json");
    const options = {
      claudeSettingsPath: settingsPath,
      claudeConfigDir: join(root, "claude-home"),
      hookScriptPath: join(root, "state", "hooks", "wosm-claude-hook.sh"),
      env: {},
    };
    await installClaudeHooks(options);
    await writeFile(settingsPath, "{ broken", "utf8");

    const doctor = await doctorClaudeHooks({ ...options, enabled: true });

    expect(doctor.status).toBe("warn");
    expect(doctor.artifactInvalid).toBe(true);
    expect(doctor.message).toContain("silently ignores");
  });
});

function userSettingsWithGeneratedEntries(hookScriptPath: string): string {
  return JSON.stringify(
    {
      theme: "dark",
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: hookScriptPath,
                timeout: 30,
                statusMessage: "Notify wosm",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: hookScriptPath,
                timeout: 30,
                statusMessage: "Notify wosm",
              },
              { type: "command", command: "/home/user/my-own-hook.sh" },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
}

async function runHookScript(
  scriptPath: string,
  stdin: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) {
    childEnv.PATH = process.env.PATH;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  const child = spawn(scriptPath, [], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.write(stdin);
  child.stdin.end();

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
