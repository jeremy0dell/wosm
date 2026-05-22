import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertDebugBundleContains } from "../../support/real-wosm/assertions";
import { writeRealWosmConfig } from "../../support/real-wosm/config";
import {
  type RealDogfoodEnvironment,
  realDogfoodEnabled,
  requireRealDogfoodEnvironment,
} from "../../support/real-wosm/env";
import { CleanupStack, runWosmJson } from "../../support/real-wosm/process";
import { createRealTempRepo } from "../../support/real-wosm/repo";
import { killTmuxSession } from "../../support/real-wosm/tmux";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

type HookReceipt = {
  hookId: string;
  status: "ingested" | "spooled" | "rejected";
};

describeReal("real Worktrunk hook dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
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
        args: ["hooks", "uninstall", "worktrunk", "--yes", "--wosm-bin", env.wosmBin],
      }).catch(() => undefined);
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, config.tmuxSession);
    });

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "install", "worktrunk", "--yes", "--wosm-bin", env.wosmBin],
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ installed: true });
    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "doctor", "worktrunk", "--wosm-bin", env.wosmBin],
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["hooks", "uninstall", "worktrunk", "--yes", "--wosm-bin", env.wosmBin],
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
    const online = await runWosmJson<HookReceipt>(env, {
      configPath: config.configPath,
      args: ["hook", "worktrunk", "post-create"],
      stdin: JSON.stringify({ branch: "wosm/hook-online" }),
      timeoutMs: 30_000,
    });
    expect(online.status).toBe("ingested");

    await runWosmJson(env, { configPath: config.configPath, args: ["observer", "stop"] });
    const offline = await runWosmJson<HookReceipt>(env, {
      configPath: config.configPath,
      args: ["hook", "worktrunk", "post-create"],
      stdin: JSON.stringify({ branch: "wosm/hook-offline" }),
      timeoutMs: 45_000,
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

    const spooled = await runWosmJson<HookReceipt>(env, {
      configPath: spoolConfig.configPath,
      args: ["hook", "worktrunk", "post-create"],
      stdin: JSON.stringify({ branch: "wosm/hook-spooled" }),
      timeoutMs: 30_000,
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
