import type { CommandRecord, WosmCommand } from "@wosm/contracts";
import { buildWorkbenchWindowName } from "@wosm/tmux";
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
import {
  createRealObserverClient,
  waitForCommandRecord,
  waitForSnapshot,
} from "../../support/real-wosm/protocol";
import { createRealTempRepo, uniqueBranch } from "../../support/real-wosm/repo";
import { killTmuxSession, listTmuxWindows } from "../../support/real-wosm/tmux";
import { removeRealWorktrunkWorktree } from "../../support/real-wosm/worktrunk";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

type CommandDispatchWaitResult = {
  status: "succeeded" | "failed";
  receipt: { commandId: string };
  command: CommandRecord;
};

describeReal("real Codex session lifecycle dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("creates a real Worktrunk worktree, launches Codex, observes state, focuses, and removes it", async () => {
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

    const branch = uniqueBranch(
      "codex-lifecycle-customer-account-permissions-rollout-for-enterprise-alpha",
    );
    cleanup.defer(async () => {
      await removeRealWorktrunkWorktree({ env, config, repo, branch });
    });
    const sentinel = createCodexSentinel(repo, "lifecycle");
    const createCommand: WosmCommand = {
      type: "session.create",
      payload: {
        projectId: config.projectId,
        branch,
        harness: {
          provider: "codex",
          mode: "exec",
        },
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: false,
        },
        initialPrompt: sentinel.prompt,
      },
    };

    let createResult: CommandDispatchWaitResult | undefined;
    try {
      createResult = await runWosmJson<CommandDispatchWaitResult>(env, {
        configPath: config.configPath,
        args: ["command", "dispatch", "--stdin", "--wait", "--timeout-ms", "180000"],
        stdin: JSON.stringify(createCommand),
        timeoutMs: 190_000,
      });
      expect(createResult.status).toBe("succeeded");

      const client = createRealObserverClient(config);
      const snapshot = await waitForSnapshot(
        client,
        (candidate) => {
          try {
            const row = findRowByBranch(candidate, branch);
            return (
              row.agent?.harness === "codex" &&
              row.terminal?.hasPrimaryAgentEndpoint === true &&
              row.terminal.focusable === true
            );
          } catch {
            return false;
          }
        },
        `Timed out waiting for Codex row ${branch} to expose agent and terminal state.`,
        90_000,
      );
      const row = findRowByBranch(snapshot, branch);
      await waitForCodexSentinel(sentinel, { rootPath: row.path });
      expect(row.agent).toMatchObject({
        harness: "codex",
        sessionId: expect.any(String),
      });
      expect(row.terminal).toMatchObject({
        provider: "tmux",
        state: expect.stringMatching(/^(open|detached|unknown)$/),
        focusable: true,
        hasPrimaryAgentEndpoint: true,
      });
      await expect(listTmuxWindows(env, config.tmuxSession)).resolves.toContain(
        expectedWindowName(config.projectId, branch, row.id, row.path),
      );

      const focusCommand: WosmCommand = {
        type: "terminal.focus",
        payload: { worktreeId: row.id },
      };
      const focusResult = await runWosmJson<CommandDispatchWaitResult>(env, {
        configPath: config.configPath,
        args: ["command", "dispatch", "--stdin", "--wait", "--timeout-ms", "60000"],
        stdin: JSON.stringify(focusCommand),
        timeoutMs: 70_000,
      });
      expect(focusResult.status).toBe("succeeded");

      const removeCommand: WosmCommand = {
        type: "session.remove",
        payload: {
          sessionId: row.agent?.sessionId ?? "",
          removeWorktree: true,
          force: true,
        },
      };
      const removeReceipt = await client.dispatch(removeCommand);
      await expect(
        waitForCommandRecord(client, removeReceipt.commandId, { timeoutMs: 90_000 }),
      ).resolves.toMatchObject({
        status: "succeeded",
      });
    } catch (error) {
      await writeFailureBundle({
        env,
        configPath: config.configPath,
        commandId: createResult?.receipt.commandId,
      });
      throw error;
    }
  }, 300_000);
});

function expectedWindowName(
  projectId: string,
  branch: string,
  worktreeId: string,
  path: string,
): string {
  return buildWorkbenchWindowName({ projectId, branch, worktreeId, path });
}
