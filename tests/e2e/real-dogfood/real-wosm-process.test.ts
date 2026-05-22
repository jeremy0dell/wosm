import type { WosmSnapshot } from "@wosm/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertDebugBundleContains,
  assertProviderHealth,
} from "../../support/real-wosm/assertions";
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

describeReal("real wosm process dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("starts, reconciles, snapshots, writes a debug bundle, and stops with real config", async () => {
    cleanup = new CleanupStack();
    const repo = await createRealTempRepo(env);
    cleanup.defer(repo.cleanup);
    const config = await writeRealWosmConfig({ env, repo });
    cleanup.defer(async () => {
      await runWosmJson(env, {
        configPath: config.configPath,
        args: ["observer", "stop"],
      }).catch(() => undefined);
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, config.tmuxSession);
    });

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["observer", "start", "--timeout-ms", "30000"],
        timeoutMs: 45_000,
      }),
    ).resolves.toMatchObject({ status: "running" });

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["observer", "status"],
      }),
    ).resolves.toMatchObject({ status: "running" });

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["reconcile", "--reason", "real-dogfood-process"],
        timeoutMs: 60_000,
      }),
    ).resolves.toMatchObject({
      snapshot: { projects: [expect.objectContaining({ id: config.projectId })] },
    });

    const snapshot = await runWosmJson<WosmSnapshot>(env, {
      configPath: config.configPath,
      args: ["snapshot", "--json", "--include-debug"],
      timeoutMs: 30_000,
    });
    assertProviderHealth(snapshot, "worktrunk");
    assertProviderHealth(snapshot, "tmux");
    assertProviderHealth(snapshot, "codex");

    const bundle = await runWosmJson<{ bundlePath: string }>(env, {
      configPath: config.configPath,
      args: ["debug", "bundle"],
      timeoutMs: 30_000,
    });
    await assertDebugBundleContains(bundle.bundlePath, "provider-health.json", "worktrunk");

    await expect(
      runWosmJson(env, {
        configPath: config.configPath,
        args: ["observer", "stop"],
      }),
    ).resolves.toMatchObject({ stopped: true });
  }, 180_000);
});
