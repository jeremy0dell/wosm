import { readFile } from "node:fs/promises";
import { parseWorktrunkListJson, WorktrunkProviderError } from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";

const now = "2026-05-21T12:00:00.000Z";
const project = {
  id: "web",
  label: "web",
  root: "/tmp/wosm/web",
  defaults: {
    harness: "codex",
    terminal: "tmux",
    layout: "agent-shell",
  },
  worktrunk: {
    enabled: true,
    base: "main",
  },
};

describe("Worktrunk list parser", () => {
  it("normalizes Worktrunk JSON into provider-neutral observations", async () => {
    const source = await fixture("list.json");

    const observations = parseWorktrunkListJson(source, {
      project,
      observedAt: now,
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      id: "wt_provider_feature_auth",
      provider: "worktrunk",
      projectId: "web",
      branch: "feature/auth",
      path: "/tmp/wosm/web/feature-auth",
      state: "exists",
      source: "worktrunk",
      dirty: true,
      ahead: 2,
      behind: 1,
      confidence: "high",
      observedAt: now,
      providerData: {
        metadata: {
          source: "provider-native",
          projectId: "web",
          worktreeId: "wt_provider_feature_auth",
        },
      },
    });
    expect(observations[1]?.branch).toBe("detached:abc1234");
    expect(observations[1]?.dirty).toBe(false);
  });

  it("rejects invalid structured output with a typed provider error", async () => {
    const source = await fixture("invalid-list.json");

    expect(() =>
      parseWorktrunkListJson(source, {
        project,
        observedAt: now,
      }),
    ).toThrow(WorktrunkProviderError);
  });

  it("rejects non-JSON output with a typed provider error", () => {
    expect(() =>
      parseWorktrunkListJson("not-json", {
        project,
        observedAt: now,
      }),
    ).toThrow("Worktrunk list output is not valid JSON.");
  });
});

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}
