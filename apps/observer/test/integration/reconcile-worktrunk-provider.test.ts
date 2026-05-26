import type { WosmConfig } from "@wosm/config";
import { FakeHarnessProvider, FakeTerminalProvider } from "@wosm/testing";
import { WorktrunkProvider } from "@wosm/worktrunk";
import { describe, expect, it } from "vitest";
import { createFakeWorktrunkRunner } from "../../../../tests/support/fake-external-tools/worktrunk";
import { createObserverCore, ProviderRegistry } from "../../src/internal";

const now = "2026-05-21T12:00:00.000Z";

describe("observer reconcile with Worktrunk provider", () => {
  it("reconciles Worktrunk observations into provider-neutral rows", async () => {
    const calls: string[][] = [];
    const providers = new ProviderRegistry({
      worktree: new WorktrunkProvider({
        command: "wt",
        clock: { now: () => new Date(now) },
        runner: createFakeWorktrunkRunner({
          listJson: [
            {
              path: "/tmp/wosm/web/feature-auth",
              branch: "feature/auth",
              worktree: { modified: 1 },
              main: { ahead: 1, behind: 0 },
            },
          ],
          onCall: (input) => calls.push(input.args ?? []),
        }),
      }),
      terminal: new FakeTerminalProvider({ now }),
      harnesses: [new FakeHarnessProvider({ now })],
    });
    const core = createObserverCore({
      config,
      providers,
      clock: { now: () => new Date(now) },
    });

    const snapshot = await core.reconcile("worktrunk-provider");

    expect(snapshot.rows).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^wt_web_feature_auth_[a-f0-9]{10}$/),
        projectId: "web",
        branch: "feature/auth",
        worktree: expect.objectContaining({
          source: "worktrunk",
          dirty: true,
          ahead: 1,
        }),
      }),
    ]);
    expect(snapshot.providerHealth.worktrunk?.status).toBe("healthy");
    expect(calls).toContainEqual(["list", "--format=json"]);
  });
});

const config: WosmConfig = {
  schemaVersion: 1,
  defaults: {
    worktreeProvider: "worktrunk",
    terminal: "fake-terminal",
    harness: "fake-harness",
    layout: "agent-shell",
  },
  projects: [
    {
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
        base: "main",
      },
    },
  ],
};
