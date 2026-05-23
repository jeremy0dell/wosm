import type { CommandRecord, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findRowByBranch } from "../../support/real-wosm/assertions";
import {
  createCodexSentinel,
  waitForCodexSentinel,
  writeFailureBundle,
} from "../../support/real-wosm/codex";
import { writeRealWosmConfig } from "../../support/real-wosm/config";
import {
  type RealDogfoodEnvironment,
  realDogfoodEnabled,
  requireRealDogfoodEnvironment,
} from "../../support/real-wosm/env";
import { CleanupStack, runWosmJson } from "../../support/real-wosm/process";
import { createRealTempRepo, uniqueBranch } from "../../support/real-wosm/repo";
import { killTmuxSession } from "../../support/real-wosm/tmux";
import {
  createRealWorktrunkWorktree,
  removeRealWorktrunkWorktree,
} from "../../support/real-wosm/worktrunk";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

type CommandDispatchWaitResult = {
  status: "succeeded" | "failed";
  receipt: { commandId: string };
  command: CommandRecord;
};

describeReal("real existing Worktrunk worktree start-agent dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("starts Codex on a real Worktrunk-created worktree with no prior agent", async () => {
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

    const branch = uniqueBranch("existing");
    cleanup.defer(async () => {
      await removeRealWorktrunkWorktree({ env, config, repo, branch });
    });
    await createRealWorktrunkWorktree({ env, config, repo, branch });

    await runWosmJson(env, {
      configPath: config.configPath,
      args: ["reconcile", "--reason", "real-existing-worktree"],
      timeoutMs: 60_000,
    });
    const before = await runWosmJson<WosmSnapshot>(env, {
      configPath: config.configPath,
      args: ["snapshot", "--json"],
      timeoutMs: 30_000,
    });
    const row = findRowByBranch(before, branch);
    expect(row.agent).toBeUndefined();

    const sentinel = createCodexSentinel(repo, "start-agent");
    const command: WosmCommand = {
      type: "session.startAgent",
      payload: {
        projectId: config.projectId,
        worktreeId: row.id,
        harness: {
          provider: "codex",
          mode: "exec",
        },
        terminal: {
          provider: "tmux",
          focus: false,
        },
        initialPrompt: sentinel.prompt,
      },
    };

    let result: CommandDispatchWaitResult | undefined;
    try {
      result = await runWosmJson<CommandDispatchWaitResult>(env, {
        configPath: config.configPath,
        args: ["command", "dispatch", "--stdin", "--wait", "--timeout-ms", "180000"],
        stdin: JSON.stringify(command),
        timeoutMs: 190_000,
      });
      expect(result.status).toBe("succeeded");
      await waitForCodexSentinel(sentinel, { rootPath: row.path });
      const after = await runWosmJson<WosmSnapshot>(env, {
        configPath: config.configPath,
        args: ["snapshot", "--json", "--include-debug"],
        timeoutMs: 30_000,
      });
      expect(findRowByBranch(after, branch).agent).toMatchObject({
        harness: "codex",
        sessionId: expect.any(String),
      });
    } catch (error) {
      await writeFailureBundle({
        env,
        configPath: config.configPath,
        commandId: result?.receipt.commandId,
      });
      throw error;
    }
  }, 300_000);
});
