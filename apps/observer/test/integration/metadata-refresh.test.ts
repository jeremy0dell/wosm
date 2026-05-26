import type { WosmConfig } from "@wosm/config";
import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { createFakeExternalCommandRunner } from "@wosm/runtime";
import {
  createFakeWorktree,
  FakeHarnessProvider,
  FakeTerminalProvider,
  FakeWorktreeProvider,
} from "@wosm/testing";
import { describe, expect, it } from "vitest";
import {
  createCommandQueue,
  createObserverApi,
  createObserverCore,
  createObserverEventBus,
  createObserverPersistence,
  createWorktreeMetadataRefreshService,
  openObserverSqlite,
  ProviderRegistry,
  providerProjectsFromConfig,
} from "../../src/internal";

const now = "2026-05-20T12:00:00.000Z";
const headSha = "2222222222222222222222222222222222222222";
const baseSha = "1111111111111111111111111111111111111111";

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "fake-worktree",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [
    {
      id: "web",
      label: "web",
      root: "/tmp/wosm/web",
      defaultBranch: "main",
      defaults: {
        harness: "fake-harness",
        terminal: "fake-terminal",
        layout: "agent-shell",
      },
      worktrunk: {
        enabled: true,
      },
    },
  ],
};

describe("observer worktree metadata refresh", () => {
  it("writes changed local git change summary metadata and requests a metadata reconcile", async () => {
    const fixture = createFixture();
    const reasons: string[] = [];
    const runner = gitRunner({
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "",
      "rev-parse --verify refs/heads/main^{commit}": baseSha,
      "diff --numstat main...HEAD": "4\t2\tsrc/a.ts\n-\t-\tassets/logo.png\n",
    });
    const service = createWorktreeMetadataRefreshService({
      projects: providerProjectsFromConfig(config),
      persistence: fixture.persistence,
      requestReconcile: (reason) => reasons.push(reason),
      clock: fixture.clock,
      runner,
    });

    const snapshot = await fixture.core.reconcile("metadata-refresh-before");
    await service.refresh(snapshot);

    await expect(
      fixture.persistence.listWorktreeMetadataCurrent({ kind: "change_summary", now }),
    ).resolves.toEqual([
      expect.objectContaining({
        worktreeId: "wt_web_feature",
        payload: expect.objectContaining({
          additions: 4,
          deletions: 2,
          filesChanged: 2,
          binaryFiles: 1,
          baseRef: "main",
          baseSha,
          headSha,
          source: "local_git",
        }),
      }),
    ]);
    expect(reasons).toEqual(["metadata:change_summary"]);
    fixture.sqlite.close();
  });

  it("marks an existing change summary stale when local git refresh fails", async () => {
    const fixture = createFixture();
    const reasons: string[] = [];
    await fixture.persistence.upsertWorktreeMetadataCurrent({
      worktreeId: "wt_web_feature",
      kind: "change_summary",
      cacheKey: "old",
      expiresAt: "2026-05-20T12:05:00.000Z",
      payload: {
        kind: "branch_diff",
        additions: 1,
        deletions: 0,
        source: "local_git",
        checkedAt: now,
      },
    });
    const runner = gitRunner({
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "",
      "rev-parse --verify refs/heads/main^{commit}": baseSha,
      "diff --numstat main...HEAD": "bad\t1\tsrc/a.ts\n",
    });
    const service = createWorktreeMetadataRefreshService({
      projects: providerProjectsFromConfig(config),
      persistence: fixture.persistence,
      requestReconcile: (reason) => reasons.push(reason),
      clock: fixture.clock,
      runner,
    });

    const snapshot = await fixture.core.reconcile("metadata-refresh-failure-before");
    await service.refresh(snapshot);

    await expect(
      fixture.persistence.listWorktreeMetadataCurrent({ kind: "change_summary", now }),
    ).resolves.toEqual([
      expect.objectContaining({
        worktreeId: "wt_web_feature",
        stale: true,
        payload: expect.objectContaining({ stale: true }),
        lastError: expect.objectContaining({
          tag: "LocalGitMetadataError",
          code: "LOCAL_GIT_NUMSTAT_INVALID",
        }),
      }),
    ]);
    expect(reasons).toEqual(["metadata:change_summary"]);
    fixture.sqlite.close();
  });

  it("does not fail API reconcile when background metadata refresh fails", async () => {
    const fixture = createFixture();
    const eventBus = createObserverEventBus();
    const api = createObserverApi({
      core: fixture.core,
      persistence: fixture.persistence,
      commandQueue: createCommandQueue({
        persistence: fixture.persistence,
        clock: fixture.clock,
        idFactory: ids(),
        eventBus,
      }),
      eventBus,
      clock: fixture.clock,
      metadataRefresh: {
        refresh: async () => {
          throw new Error("metadata refresh failed");
        },
      },
    });

    await expect(api.reconcile("metadata-refresh-background-failure")).resolves.toMatchObject({
      reason: "metadata-refresh-background-failure",
      snapshot: {
        counts: {
          worktrees: 1,
        },
      },
    });
    fixture.sqlite.close();
  });
});

function createFixture() {
  const clock = { now: () => new Date(now) };
  const sqlite = openObserverSqlite({ clock });
  const persistence = createObserverPersistence({
    sqlite,
    clock,
    idFactory: ids(),
  });
  const providers = new ProviderRegistry({
    worktree: new FakeWorktreeProvider({
      now,
      worktrees: [
        createFakeWorktree({
          id: "wt_web_feature",
          projectId: "web",
          branch: "feature",
          path: "/tmp/wosm/web/feature",
          now,
        }),
      ],
    }),
    terminal: new FakeTerminalProvider({ now }),
    harnesses: [new FakeHarnessProvider({ now })],
  });
  const core = createObserverCore({
    config,
    providers,
    persistence,
    sqlite,
    clock,
  });
  return {
    clock,
    sqlite,
    persistence,
    core,
  };
}

function gitRunner(responses: Record<string, string>) {
  return createFakeExternalCommandRunner((input: ExternalCommandInput): ExternalCommandResult => {
    const key = [input.command, ...(input.args ?? [])].slice(1).join(" ");
    const stdout = responses[key];
    if (stdout === undefined) {
      throw Object.assign(new Error(`No fake git response for ${key}`), {
        code: 1,
        stderr: "not found",
      });
    }
    return {
      command: input.command,
      args: input.args ?? [],
      stdout,
      stderr: "",
      exitCode: 0,
    };
  });
}

function ids() {
  let command = 0;
  let event = 0;
  let observation = 0;
  let breadcrumb = 0;
  return {
    commandId: () => `cmd_${++command}`,
    eventId: () => `evt_${++event}`,
    observationId: () => `obs_${++observation}`,
    breadcrumbId: () => `crumb_${++breadcrumb}`,
  };
}
