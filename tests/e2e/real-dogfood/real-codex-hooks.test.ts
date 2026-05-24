import type { CommandRecord, WosmCommand, WosmSnapshot } from "@wosm/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertDebugBundleContains, findRowByBranch } from "../../support/real-wosm/assertions";
import {
  createCodexHookEnabledWrapper,
  createCodexSentinel,
  installCodexHookProjectConfig,
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
import { captureTmuxPane, killTmuxSession, sendTmuxKeys } from "../../support/real-wosm/tmux";
import { removeRealWorktrunkWorktree } from "../../support/real-wosm/worktrunk";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

type CommandDispatchWaitResult = {
  status: "succeeded" | "failed";
  receipt: { commandId: string };
  command: CommandRecord;
};

describeReal("real Codex hook dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("launches Codex in tmux and ingests actual Codex lifecycle/tool hooks through observer", async () => {
    cleanup = new CleanupStack();
    const repo = await createRealTempRepo(env);
    cleanup.defer(repo.cleanup);
    const codexCommand = await createCodexHookEnabledWrapper({ env, repo });
    const config = await writeRealWosmConfig({ env, repo, codexCommand });
    const hooks = await installCodexHookProjectConfig({
      env,
      repo,
      configPath: config.configPath,
    });
    cleanup.defer(hooks.cleanup);
    cleanup.defer(async () => {
      await runWosmJson(env, { configPath: config.configPath, args: ["observer", "stop"] }).catch(
        () => undefined,
      );
    });
    cleanup.defer(async () => {
      await killTmuxSession(env, config.tmuxSession);
    });

    const branch = uniqueBranch("codex-hooks");
    cleanup.defer(async () => {
      await removeRealWorktrunkWorktree({ env, config, repo, branch });
    });
    const sentinel = createCodexSentinel(repo, "hooks");
    const createCommand: WosmCommand = {
      type: "session.create",
      payload: {
        projectId: config.projectId,
        branch,
        harness: {
          provider: "codex",
          mode: "interactive",
        },
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
          focus: true,
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

      const snapshot = await runWosmJson<WosmSnapshot>(env, {
        configPath: config.configPath,
        args: ["snapshot", "--json", "--include-debug"],
        timeoutMs: 30_000,
      });
      const row = findRowByBranch(snapshot, branch);
      await continuePastCodexStartupPrompts(env, row);
      const activeRow = await waitForRowAgentState({
        env,
        configPath: config.configPath,
        branch,
        states: ["working", "needs_attention"],
        timeoutMs: 180_000,
      });
      await waitForCodexSentinel(sentinel, { rootPath: row.path, timeoutMs: 240_000 });
      expect(activeRow.agent).toMatchObject({
        harness: "codex",
        state: expect.stringMatching(/^(working|needs_attention)$/),
        sessionId: expect.any(String),
      });
      const idleRow = await waitForRowAgentState({
        env,
        configPath: config.configPath,
        branch,
        states: ["idle"],
        timeoutMs: 180_000,
      });
      expect(idleRow.agent).toMatchObject({
        harness: "codex",
        state: "idle",
        sessionId: activeRow.agent?.sessionId,
      });

      const bundle = await runWosmJson<{ bundlePath: string }>(env, {
        configPath: config.configPath,
        args: ["debug", "bundle"],
        timeoutMs: 30_000,
      });
      await assertDebugBundleContains(bundle.bundlePath, "events.jsonl", "hook.ingested");
      await assertDebugBundleContains(bundle.bundlePath, "events.jsonl", '"provider":"codex"');
      await assertDebugBundleContains(bundle.bundlePath, "logs/observer.jsonl", "hook:codex");
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

async function waitForRowAgentState(input: {
  env: RealDogfoodEnvironment;
  configPath: string;
  branch: string;
  states: Array<NonNullable<WosmSnapshot["rows"][number]["agent"]>["state"]>;
  timeoutMs: number;
}): Promise<WosmSnapshot["rows"][number]> {
  const allowed = new Set(input.states);
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const snapshot = await runWosmJson<WosmSnapshot>(input.env, {
        configPath: input.configPath,
        args: ["snapshot", "--json", "--include-debug"],
        timeoutMs: 30_000,
      });
      const row = findRowByBranch(snapshot, input.branch);
      if (row.agent !== undefined && allowed.has(row.agent.state)) {
        return row;
      }
    } catch {
      // The branch can be absent briefly while the session command settles.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for Codex row ${input.branch} to enter ${input.states.join("/")}.`,
  );
}

async function continuePastCodexStartupPrompts(
  env: RealDogfoodEnvironment,
  row: WosmSnapshot["rows"][number],
): Promise<void> {
  const targetId = row.terminal?.primaryAgentTargetId;
  if (targetId === undefined) {
    throw new Error(`Row ${row.id} has no primary Codex tmux target.`);
  }
  const target = tmuxPaneTarget(targetId);
  const deadline = Date.now() + 30_000;
  while (Date.now() <= deadline) {
    const captured = await captureTmuxPane({ env, target });
    if (captured.includes("Do you trust the contents of this directory?")) {
      await sendTmuxKeys({ env, target, keys: ["1", "Enter"] });
    }
    if (captured.includes("hooks need review") && captured.includes("Press t to trust all")) {
      await sendTmuxKeys({ env, target, keys: ["t"] });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function tmuxPaneTarget(targetId: string): string {
  return targetId.split(":").at(-1) ?? targetId;
}
