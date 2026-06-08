import { join } from "node:path";
import { runProviderIngressCommand } from "@wosm/provider-hooks";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertDebugBundleContains } from "../../support/real-wosm/assertions";
import { type RealWosmConfigFixture, writeRealWosmConfig } from "../../support/real-wosm/config";
import {
  type RealE2eEnvironment,
  realE2eEnabled,
  requireRealE2eEnvironment,
} from "../../support/real-wosm/env";
import { CleanupStack, runWosmJson } from "../../support/real-wosm/process";
import { createRealTempRepo } from "../../support/real-wosm/repo";
import { killTmuxSession } from "../../support/real-wosm/tmux";

const describeReal = realE2eEnabled() ? describe : describe.skip;

type ProviderHookReceipt = {
  hookId: string;
  status: "ingested" | "spooled" | "rejected";
};

describeReal("real Worktrunk hook ingestion", () => {
  let env: RealE2eEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealE2eEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("installs, doctors, and uninstalls real Worktrunk hooks", async () => {
    cleanup = new CleanupStack();
    const repo = await createRealTempRepo(env);
    cleanup.defer(repo.cleanup);
    const config = await writeRealWosmConfig({ env, repo, useLifecycleHooks: true });
    cleanup.defer(async () => {
      await runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "uninstall", "worktrunk", "--yes", "--hook-bin", env.wosmIngressBin],
      }).catch(() => undefined);
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, config.tmuxSession);
    });

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "install", "worktrunk", "--yes", "--hook-bin", env.wosmIngressBin],
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ installed: true });
    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "doctor", "worktrunk", "--hook-bin", env.wosmIngressBin],
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "uninstall", "worktrunk", "--yes", "--hook-bin", env.wosmIngressBin],
      }),
    ).resolves.toMatchObject({ installed: false });
  }, 120_000);

  it("delivers online, auto-starts offline, spools when disabled, and drains on startup", async () => {
    cleanup = new CleanupStack();
    const repo = await createRealTempRepo(env);
    cleanup.defer(repo.cleanup);
    const config = await writeRealWosmConfig({ env, repo });
    cleanup.defer(async () => {
      await runWosmJson(env, { configPath: config.configPath, args: ["observer", "stop"] }).catch(
        () => undefined,
      );
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, config.tmuxSession);
    });

    await runWosmJson(env, {
      configPath: config.configPath,
      args: ["observer", "start", "--timeout-ms", "30000"],
      timeoutMs: 45_000,
    });
    const online = await runWorktrunkIngress(env, config, {
      event: "post-create",
      stdin: JSON.stringify({ branch: "wosm/hook-online" }),
    });
    expect(online.status).toBe("ingested");

    await runWosmJson(env, { configPath: config.configPath, args: ["observer", "stop"] });
    const offline = await runWorktrunkIngress(env, config, {
      event: "post-create",
      stdin: JSON.stringify({ branch: "wosm/hook-offline" }),
    });
    expect(offline.status).toBe("ingested");
    await runWosmJson(env, { configPath: config.configPath, args: ["observer", "stop"] });

    const spoolRepo = await createRealTempRepo(env);
    cleanup.defer(spoolRepo.cleanup);
    const spoolConfig = await writeRealWosmConfig({
      env,
      repo: spoolRepo,
      autoStartFromHooks: false,
    });
    cleanup.defer(async () => {
      await runWosmJson(env, {
        configPath: spoolConfig.configPath,
        args: ["observer", "stop"],
      }).catch(() => undefined);
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, spoolConfig.tmuxSession);
    });

    const spooled = await runWorktrunkIngress(env, spoolConfig, {
      event: "post-create",
      stdin: JSON.stringify({ branch: "wosm/hook-spooled" }),
      autoStart: false,
    });
    expect(spooled.status).toBe("spooled");
    await runWosmJson(env, {
      configPath: spoolConfig.configPath,
      args: ["reconcile", "--reason", "real-hook-drain"],
      timeoutMs: 60_000,
    });
    const bundle = await runWosmJson<{ bundlePath: string }>(env, {
      configPath: spoolConfig.configPath,
      args: ["debug", "bundle"],
      timeoutMs: 30_000,
    });
    await assertDebugBundleContains(bundle.bundlePath, "logs/observer.jsonl", spooled.hookId);
  }, 180_000);
});

async function runWorktrunkIngress(
  env: RealE2eEnvironment,
  config: RealWosmConfigFixture,
  input: {
    event: string;
    stdin: string;
    autoStart?: boolean;
  },
): Promise<ProviderHookReceipt> {
  const receipt = await runProviderIngressCommand(
    [
      "--socket",
      config.socketPath,
      "--state-dir",
      config.stateDir,
      "--spool-dir",
      join(config.stateDir, "spool", "hooks"),
      "--config",
      config.configPath,
      ...(input.autoStart === false ? ["--no-auto-start"] : []),
      "worktrunk",
      input.event,
    ],
    {
      stdin: input.stdin,
      observerEntryPath: join(env.repoRoot, "apps", "observer", "dist", "runtime", "main.js"),
    },
  );
  return {
    hookId: receipt.hookId,
    status: receipt.status,
  };
}
