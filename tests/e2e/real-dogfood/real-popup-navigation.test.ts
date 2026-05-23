import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WosmSnapshot } from "@wosm/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findRowByBranch } from "../../support/real-wosm/assertions";
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
import {
  activeTmuxPane,
  activeTmuxWindow,
  displayWosmPopupAndSendKey,
  killTmuxSession,
} from "../../support/real-wosm/tmux";
import {
  createRealWorktrunkWorktree,
  removeRealWorktrunkWorktree,
} from "../../support/real-wosm/worktrunk";

const describeReal = realDogfoodEnabled() ? describe : describe.skip;

describeReal("real tmux popup navigation dogfood", () => {
  let env: RealDogfoodEnvironment;
  let cleanup: CleanupStack;

  beforeAll(async () => {
    env = await requireRealDogfoodEnvironment({ worktrunk: true, tmux: true, codex: true });
  });

  afterEach(async () => {
    await cleanup?.run();
  });

  it("opens the real TUI in a tmux popup over the created agent pane and lands in that pane", async () => {
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

    const branch = uniqueBranch("popup");
    cleanup.defer(async () => {
      await removeRealWorktrunkWorktree({ env, config, repo, branch });
    });
    await createRealWorktrunkWorktree({ env, config, repo, branch });
    await runWosmJson(env, {
      configPath: config.configPath,
      args: ["reconcile", "--reason", "real-popup-preload"],
      timeoutMs: 60_000,
    });

    const client = createRealObserverClient(config, 30_000);
    const initialSnapshot = await waitForSnapshot(
      client,
      (candidate) => findMaybeRow(candidate, branch) !== undefined,
      "Observer did not discover the popup navigation worktree.",
      60_000,
    );
    const initialRow = findRowByBranch(initialSnapshot, branch);
    const receipt = await client.dispatch({
      type: "session.startAgent",
      payload: {
        projectId: config.projectId,
        worktreeId: initialRow.id,
        harness: {
          provider: "codex",
          mode: "interactive",
        },
        terminal: {
          provider: "tmux",
          layout: "agent-build-shell",
        },
      },
    });
    await waitForCommandRecord(client, receipt.commandId, { timeoutMs: 120_000 });

    const agentSnapshot = await waitForSnapshot(
      client,
      (candidate) => findMaybeRow(candidate, branch)?.agent?.harness === "codex",
      "Observer did not attach a Codex agent before popup navigation.",
      120_000,
    );
    const agentRow = findRowByBranch(agentSnapshot, branch);
    const targetId = agentRow.terminal?.primaryAgentTargetId;
    if (targetId === undefined) {
      throw new Error("Popup navigation row does not expose a primary agent target.");
    }
    const paneId = paneIdFromTargetId(targetId);
    const windowName = expectedWindowName(config.projectId, branch);
    const markerPath = join(repo.root, "popup-navigation.marker");

    await displayWosmPopupAndSendKey({
      env,
      configPath: config.configPath,
      target: `${config.tmuxSession}:${windowName}.0`,
      key: "1",
      markerPath,
    });

    await expect(readFile(markerPath, "utf8")).resolves.toContain("popup-started");
    await expect(readFile(markerPath, "utf8")).resolves.toContain("key-sent");
    await expect(activeTmuxWindow(env, config.tmuxSession)).resolves.toBe(windowName);
    await expect(activeTmuxPane(env, config.tmuxSession)).resolves.toBe(paneId);
  }, 240_000);
});

function findMaybeRow(snapshot: WosmSnapshot, branch: string) {
  return snapshot.rows.find((row) => row.branch === branch);
}

function paneIdFromTargetId(targetId: string): string {
  const paneId = targetId.split(":").at(-1);
  if (paneId === undefined || paneId.length === 0) {
    throw new Error(`Invalid terminal target id: ${targetId}`);
  }
  return paneId;
}

function expectedWindowName(projectId: string, branch: string): string {
  const normalized = `${projectId}-${branch}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .replaceAll(/-{2,}/g, "-");
  const safe = normalized.length > 0 ? normalized : "worktree";
  return safe.slice(0, 48).replaceAll(/-+$/g, "") || "worktree";
}
