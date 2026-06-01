import type { CommandRecord, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  findRowBySessionTitle,
  findRowByWorktreeId,
  findSessionByTitle,
} from "../../support/real-wosm/assertions";
import {
  createCodexBranchSwitchSentinel,
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
import { createRealObserverClient, waitForSnapshot } from "../../support/real-wosm/protocol";
import { createRealTempRepo, uniqueBranch } from "../../support/real-wosm/repo";
import { killTmuxSession } from "../../support/real-wosm/tmux";
import { removeRealWorktrunkWorktree } from "../../support/real-wosm/worktrunk";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

type CommandDispatchWaitResult = {
  status: "succeeded" | "failed";
  receipt: { commandId: string };
  command: CommandRecord;
};

describeReal("real session title branch-change dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("keeps one titled session row when Codex switches the worktree branch", async () => {
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

    const originalBranch = uniqueBranch("title-original");
    const agentBranch = uniqueBranch("title-agent");
    cleanup.defer(async () => {
      await removeRealWorktrunkWorktree({
        env,
        config,
        repo,
        branch: [originalBranch, agentBranch],
      });
    });
    const sentinel = createCodexBranchSwitchSentinel(repo, "title-branch-change", agentBranch);
    const createCommand: WosmCommand = {
      type: "session.create",
      payload: {
        projectId: config.projectId,
        branch: originalBranch,
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
      const launched = await waitForSnapshot(
        client,
        (candidate) => hasSessionTitle(candidate, originalBranch),
        `Timed out waiting for session title ${originalBranch}.`,
        90_000,
      );
      const initialRow = findRowBySessionTitle(launched, originalBranch);
      await waitForCodexSentinel(sentinel, { rootPath: initialRow.path, timeoutMs: 240_000 });

      const afterSwitch = await waitForSnapshot(
        client,
        (candidate) => rowHasAgentBranch(candidate, originalBranch, agentBranch),
        `Timed out waiting for ${originalBranch} to report branch ${agentBranch}.`,
        120_000,
      );
      const titledSessions = afterSwitch.sessions.filter(
        (candidate) => candidate.title === originalBranch,
      );
      expect(titledSessions).toHaveLength(1);
      const session = titledSessions[0];
      if (session === undefined) {
        throw new Error(`Snapshot does not contain session title ${originalBranch}.`);
      }
      const row = findRowByWorktreeId(afterSwitch, session.worktreeId);

      expect(row.id).toBe(initialRow.id);
      expect(row.branch).toBe(agentBranch);
      expect(row.agent).toMatchObject({
        harness: "codex",
        sessionId: session.id,
      });
      expect(session.title).toBe(originalBranch);
      expect(afterSwitch.rows.filter((candidate) => candidate.id === row.id)).toHaveLength(1);
    } catch (error) {
      await writeFailureBundle({
        env,
        configPath: config.configPath,
        commandId: createResult?.receipt.commandId,
      });
      throw error;
    }
  }, 360_000);
});

function hasSessionTitle(snapshot: WosmSnapshot, title: string): boolean {
  return snapshot.sessions.some((candidate) => candidate.title === title);
}

function rowHasAgentBranch(snapshot: WosmSnapshot, title: string, branch: string): boolean {
  try {
    const session = findSessionByTitle(snapshot, title);
    const row = findRowByWorktreeId(snapshot, session.worktreeId);
    return row.branch === branch && row.agent?.sessionId === session.id;
  } catch {
    return false;
  }
}
