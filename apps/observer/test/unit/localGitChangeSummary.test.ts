import type { ExternalCommandInput, ExternalCommandResult } from "@wosm/runtime";
import { createFakeExternalCommandRunner } from "@wosm/runtime";
import { describe, expect, it } from "vitest";
import type { LocalGitChangeSummaryInput } from "../../src/metadata/localGitChangeSummary";
import {
  parseGitNumstat,
  readLocalGitChangeSummary,
} from "../../src/metadata/localGitChangeSummary";

const now = "2026-05-20T12:00:00.000Z";
const headSha = "2222222222222222222222222222222222222222";
const baseSha = "1111111111111111111111111111111111111111";

const baseInput: Omit<LocalGitChangeSummaryInput, "runner"> = {
  project: {
    id: "web",
    label: "web",
    root: "/tmp/wosm/web",
    defaults: {
      harness: "fake-harness",
      terminal: "fake-terminal",
      layout: "agent-shell",
    },
    worktrunk: {
      enabled: true,
    },
  },
  worktree: {
    id: "wt_web_feature",
    projectId: "web",
    path: "/tmp/wosm/web/feature",
    branch: "feature",
    state: "exists",
  },
  clock: { now: () => new Date(now) },
};

describe("local git change summary", () => {
  it("parses normal numstat output", () => {
    expect(parseGitNumstat("1\t2\tsrc/a.ts\n3\t4\tsrc/b.ts\n")).toEqual({
      additions: 4,
      deletions: 6,
      filesChanged: 2,
      binaryFiles: 0,
    });
  });

  it("counts binary numstat rows as changed and binary files", () => {
    expect(parseGitNumstat("1\t0\tsrc/a.ts\n-\t-\tassets/logo.png\n")).toEqual({
      additions: 1,
      deletions: 0,
      filesChanged: 2,
      binaryFiles: 1,
    });
  });

  it("rejects malformed numstat output with a typed safe error", () => {
    try {
      parseGitNumstat("wat\t1\tsrc/a.ts\n");
      throw new Error("Expected malformed numstat output to throw.");
    } catch (error) {
      expect(error).toMatchObject({
        tag: "LocalGitMetadataError",
        code: "LOCAL_GIT_NUMSTAT_INVALID",
      });
    }
  });

  it("resolves base from configured default branch", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "origin\n",
      "rev-parse --verify refs/heads/main^{commit}": baseSha,
      "diff --numstat main...HEAD": "5\t1\tsrc/a.ts\n",
    });

    const result = await readLocalGitChangeSummary({
      ...baseInput,
      project: {
        ...baseInput.project,
        defaultBranch: "main",
      },
      runner,
    });

    expect(result?.summary).toMatchObject({
      additions: 5,
      deletions: 1,
      filesChanged: 1,
      binaryFiles: 0,
      baseRef: "main",
      baseSha,
      headSha,
      source: "local_git",
    });
    expect(calls).toContain("diff --numstat main...HEAD");
  });

  it("resolves unqualified Worktrunk base through origin when no local branch exists", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "origin\nupstream\n",
      "rev-parse --verify refs/remotes/origin/develop^{commit}": baseSha,
      "diff --numstat origin/develop...HEAD": "2\t3\tsrc/a.ts\n",
    });

    const result = await readLocalGitChangeSummary({
      ...baseInput,
      project: {
        ...baseInput.project,
        worktrunk: {
          enabled: true,
          base: "develop",
        },
      },
      runner,
    });

    expect(result?.summary).toMatchObject({
      additions: 2,
      deletions: 3,
      baseRef: "origin/develop",
    });
    expect(calls).toContain("rev-parse --verify refs/heads/develop^{commit}");
    expect(calls).toContain("diff --numstat origin/develop...HEAD");
  });

  it("resolves base from remote HEAD before local fallback", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "upstream\norigin\n",
      "symbolic-ref --quiet --short refs/remotes/origin/HEAD": "origin/trunk\n",
      "rev-parse --verify origin/trunk^{commit}": baseSha,
      "diff --numstat origin/trunk...HEAD": "1\t1\tsrc/a.ts\n",
    });

    const result = await readLocalGitChangeSummary({
      ...baseInput,
      runner,
    });

    expect(result?.summary.baseRef).toBe("origin/trunk");
    expect(calls).toContain("diff --numstat origin/trunk...HEAD");
  });

  it("falls back to local main when configured and remote bases are unavailable", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "",
      "rev-parse --verify refs/heads/main^{commit}": baseSha,
      "diff --numstat main...HEAD": "",
    });

    const result = await readLocalGitChangeSummary({
      ...baseInput,
      runner,
    });

    expect(result?.summary).toMatchObject({
      additions: 0,
      deletions: 0,
      filesChanged: 0,
      baseRef: "main",
    });
  });

  it("prefers cached pull request base over project defaults", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "origin\n",
      "rev-parse --verify refs/heads/release^{commit}": baseSha,
      "diff --numstat release...HEAD": "1\t0\tsrc/a.ts\n",
    });

    const result = await readLocalGitChangeSummary({
      ...baseInput,
      project: {
        ...baseInput.project,
        defaultBranch: "main",
      },
      cachedPullRequest: {
        number: 1,
        baseRef: "release",
        checkedAt: now,
      },
      runner,
    });

    expect(result?.summary.baseRef).toBe("release");
    expect(calls).not.toContain("rev-parse --verify refs/heads/main^{commit}");
  });

  it("omits metadata when no base can be resolved", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "",
    });

    await expect(
      readLocalGitChangeSummary({
        ...baseInput,
        runner,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed diff output", async () => {
    const calls: string[] = [];
    const runner = gitRunner(calls, {
      "rev-parse --verify HEAD^{commit}": headSha,
      remote: "",
      "rev-parse --verify refs/heads/main^{commit}": baseSha,
      "diff --numstat main...HEAD": "bad\t1\tsrc/a.ts\n",
    });

    await expect(
      readLocalGitChangeSummary({
        ...baseInput,
        runner,
      }),
    ).rejects.toMatchObject({
      tag: "LocalGitMetadataError",
      code: "LOCAL_GIT_NUMSTAT_INVALID",
    });
  });
});

function gitRunner(calls: string[], responses: Record<string, string>) {
  return createFakeExternalCommandRunner((input: ExternalCommandInput): ExternalCommandResult => {
    const key = [input.command, ...(input.args ?? [])].slice(1).join(" ");
    calls.push(key);
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
