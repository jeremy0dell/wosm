import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  doctorWorktrunkHooks,
  installWorktrunkHooks,
  planWorktrunkHooks,
  uninstallWorktrunkHooks,
} from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";

describe("Worktrunk hook setup", () => {
  it("plans tiny hook commands without writing config", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-hooks-"));
    const configPath = join(root, "config.toml");

    const plan = await planWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
      hookBin: "/usr/local/bin/wosm-ingress",
    });

    expect(plan.changed).toBe(true);
    expect(plan.missing).toEqual(["post-create", "post-switch", "pre-remove", "post-remove"]);
    expect(plan.commands["post-create"]).toBe(
      "/usr/local/bin/wosm-ingress --socket /tmp/wosm/run/observer.sock --state-dir /tmp/wosm/state --spool-dir /tmp/wosm/state/spool/hooks --config /tmp/wosm/config.toml worktrunk post-create",
    );
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("installs idempotently, backs up existing config, and preserves unrelated hooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-hooks-"));
    const configPath = join(root, "config.toml");
    await mkdir(root, { recursive: true });
    await writeFile(
      configPath,
      await readFile(new URL("../fixtures/worktrunk-before.toml", import.meta.url), "utf8"),
    );

    const installed = await installWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });
    const second = await installWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });
    const contents = await readFile(configPath, "utf8");

    expect(installed.backupPath).toBeDefined();
    expect(second.changed).toBe(false);
    expect(contents).toContain("echo existing");
    expect(contents).toContain("wosm-ingress");
    expect(contents).not.toContain("wosm-hook");
    await expect(
      doctorWorktrunkHooks({
        worktrunkConfigPath: configPath,
        wosmConfigPath: "/tmp/wosm/config.toml",
        observerSocketPath: "/tmp/wosm/run/observer.sock",
        stateDir: "/tmp/wosm/state",
        hookSpoolDir: "/tmp/wosm/state/spool/hooks",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      installed: true,
    });
  });

  it("uninstalls generated hooks without removing unrelated commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-hooks-"));
    const configPath = join(root, "config.toml");
    await installWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });

    const removed = await uninstallWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
      observerSocketPath: "/tmp/wosm/run/observer.sock",
      stateDir: "/tmp/wosm/state",
      hookSpoolDir: "/tmp/wosm/state/spool/hooks",
    });
    const contents = await readFile(configPath, "utf8");

    expect(removed.installed).toBe(false);
    expect(contents).not.toContain("wosm-ingress");
  });

  it("replaces and uninstalls legacy generated wosm hook commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-hooks-"));
    const configPath = join(root, "config.toml");
    await writeFile(
      configPath,
      [
        "[post-create]",
        'existing = "echo existing"',
        'wosm = "/usr/local/bin/wosm --config /tmp/wosm/config.toml hook worktrunk post-create"',
        "",
        "[post-switch]",
        'wosm = "wosm --config /tmp/wosm/config.toml hook worktrunk post-switch"',
        "",
        "[pre-remove]",
        'wosm = "wosm --config /tmp/wosm/config.toml hook worktrunk pre-remove"',
        "",
        "[post-remove]",
        'wosm = "wosm --config /tmp/wosm/config.toml hook worktrunk post-remove"',
        "",
      ].join("\n"),
    );

    await expect(
      doctorWorktrunkHooks({
        worktrunkConfigPath: configPath,
        wosmConfigPath: "/tmp/wosm/config.toml",
      }),
    ).resolves.toMatchObject({
      status: "warn",
      installed: false,
    });

    const plan = await planWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
    });
    expect(plan.changed).toBe(true);
    expect(plan.after).toContain(
      "wosm-ingress --config /tmp/wosm/config.toml worktrunk post-create",
    );
    expect(plan.after).not.toContain(" hook worktrunk post-create");

    const removed = await uninstallWorktrunkHooks({
      worktrunkConfigPath: configPath,
      wosmConfigPath: "/tmp/wosm/config.toml",
    });
    const contents = await readFile(configPath, "utf8");

    expect(removed.installed).toBe(false);
    expect(contents).toContain("echo existing");
    expect(contents).not.toContain("hook worktrunk");
  });

  it("maps invalid hook config TOML to a typed setup error", async () => {
    const root = await mkdtemp(join(tmpdir(), "wosm-wt-hooks-"));
    const configPath = join(root, "config.toml");
    await writeFile(configPath, "not = [valid");

    await expect(
      planWorktrunkHooks({
        worktrunkConfigPath: configPath,
        wosmConfigPath: "/tmp/wosm/config.toml",
      }),
    ).rejects.toMatchObject({
      tag: "WorktrunkHookSetupError",
      code: "WORKTRUNK_HOOK_INVALID_TOML",
      provider: "worktrunk",
    });
  });
});
