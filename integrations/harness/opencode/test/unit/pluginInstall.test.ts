import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  doctorOpenCodePlugin,
  installOpenCodePlugin,
  planOpenCodePlugin,
  resolveOpenCodePluginPath,
  uninstallOpenCodePlugin,
} from "../../src/pluginInstall";

describe("OpenCode plugin setup", () => {
  it("plans the generated OpenCode plugin without writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-opencode-plugin-"));
    const opencodeConfigDir = join(root, "opencode");
    const pluginPath = join(opencodeConfigDir, "plugins", "wosm-agent-state.js");

    const plan = await planOpenCodePlugin({
      opencodeConfigDir,
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });

    expect(plan).toMatchObject({
      provider: "opencode",
      configDir: opencodeConfigDir,
      pluginPath,
      changed: true,
      installed: false,
    });
    expect(plan.after).toContain("wosm-opencode-observer-plugin:v1");
    expect(plan.after).toContain('method: "observer.ingestHookEvent"');
    expect(plan.after).toContain('provider: "opencode"');
    expect(plan.after).toContain("shouldSendOpenCodeEvent");
    expect(plan.after).not.toContain('"message.part.delta"');
    expect(plan.after).not.toContain('"message.part.updated"');
    expect(plan.after).toContain('"session.next.shell.started"');
    expect(plan.after).toContain('"session.next.tool.progress"');
    expect(plan.after).toContain('"session.next.tool.input.delta"');
    expect(plan.after).toContain("/tmp/wosm/run/observer.sock");
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("installs, reports idempotence, and uninstalls only the generated plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-opencode-plugin-"));
    const pluginPath = join(root, "opencode", "plugins", "wosm-agent-state.js");

    const installed = await installOpenCodePlugin({
      pluginPath,
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });
    const second = await installOpenCodePlugin({
      pluginPath,
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });
    const script = await readFile(pluginPath, "utf8");

    expect(installed).toMatchObject({
      installed: true,
      changed: true,
    });
    expect(second).toMatchObject({
      installed: true,
      changed: false,
    });
    expect(script).toContain("WOSM_HARNESS_PROVIDER");
    expect(script).toContain("WOSM_WORKTREE_ID");
    expect(script).toContain("spoolHookEvent");
    await expect(
      doctorOpenCodePlugin({
        pluginPath,
        observerSocketPath: "/tmp/wosm/run/observer.sock",
        stateDir: "/tmp/wosm/state",
        hookSpoolDir: "/tmp/wosm/state/spool/hooks",
        enabled: true,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      installed: true,
    });

    const removed = await uninstallOpenCodePlugin({ pluginPath });
    expect(removed).toMatchObject({
      installed: false,
      changed: true,
      removed: true,
    });
    await expect(access(pluginPath)).rejects.toThrow();
  });

  it("does not remove unrelated user plugins", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-opencode-plugin-"));
    const pluginPath = join(root, "opencode", "plugins", "wosm-agent-state.js");
    await mkdir(join(root, "opencode", "plugins"), { recursive: true });
    await writeFile(pluginPath, "export const UserPlugin = async () => ({})\n", "utf8");

    const result = await uninstallOpenCodePlugin({ pluginPath });

    expect(result).toMatchObject({
      installed: false,
      changed: false,
      removed: false,
    });
    await expect(readFile(pluginPath, "utf8")).resolves.toContain("UserPlugin");
  });

  it("filters streaming message events before delivery or spool", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-opencode-plugin-"));
    const pluginPath = join(root, "opencode", "plugins", "wosm-agent-state.js");
    const spoolDir = join(root, "spool");
    await installOpenCodePlugin({
      pluginPath,
      observerSocketPath: join(root, "missing.sock"),
      stateDir: join(root, "state"),
      hookSpoolDir: spoolDir,
    });

    const previousEnv = { ...process.env };
    try {
      process.env.WOSM_HARNESS_PROVIDER = "opencode";
      process.env.WOSM_WORKTREE_ID = "wt_1";
      process.env.WOSM_HOOK_SPOOL_DIR = spoolDir;
      process.env.WOSM_OBSERVER_SOCKET_PATH = join(root, "missing.sock");
      const moduleUrl = pathToFileURL(pluginPath);
      moduleUrl.search = `v=${Date.now()}`;
      const pluginModule = (await import(moduleUrl.href)) as {
        WosmObserverPlugin: (input: { directory: string; worktree: string }) => Promise<{
          event: (input: { event: unknown }) => Promise<void>;
        }>;
      };

      const plugin = await pluginModule.WosmObserverPlugin({ directory: root, worktree: root });
      await plugin.event({
        event: {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            partID: "part_1",
          },
        },
      });

      await expect(readdir(spoolDir)).rejects.toThrow();
    } finally {
      process.env = previousEnv;
    }
  });

  it("resolves OpenCode config directory from environment", () => {
    expect(
      resolveOpenCodePluginPath({
        env: {
          OPENCODE_CONFIG_DIR: "/tmp/opencode-config",
        },
      }),
    ).toBe("/tmp/opencode-config/plugins/wosm-agent-state.js");
  });

  it("warns only when plugin installation was requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-opencode-plugin-"));
    const pluginPath = join(root, "opencode", "plugins", "wosm-agent-state.js");

    await expect(doctorOpenCodePlugin({ pluginPath, enabled: false })).resolves.toMatchObject({
      status: "ok",
      installed: false,
    });
    await expect(doctorOpenCodePlugin({ pluginPath, enabled: true })).resolves.toMatchObject({
      status: "warn",
      installed: false,
    });
  });
});
