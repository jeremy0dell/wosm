import type { ProviderHealth, WosmSnapshot } from "@wosm/contracts";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../../src/App.js";
import { createDashboardSnapshot, row } from "../fixtures/snapshots.js";
import { FakeTuiObserverService } from "../support/fakeObserverService.js";

describe("new session bottom-sheet flow", () => {
  it("creates a session with selected project, agent, and custom branch", async () => {
    const snapshot = createMultiHarnessSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
    expect(instance.lastFrame()).toContain("Project   web");
    expect(instance.lastFrame()).not.toContain("N:new 1-9:start/focus");

    instance.stdin.write("e");
    await waitFor(() => instance.lastFrame()?.includes("Edit Session Name") === true);
    expect(instance.lastFrame()).toContain("Enter:use generated name");
    instance.stdin.write("feature/custom");
    await waitFor(() => instance.lastFrame()?.includes("Enter:use name") === true);
    instance.stdin.write("\r");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature/custom") === true);

    instance.stdin.write("p");
    await waitFor(() => instance.lastFrame()?.includes("› web") === true);
    instance.stdin.write("j");
    instance.stdin.write("\r");
    await waitFor(
      () =>
        instance.lastFrame()?.includes("Project   api") === true &&
        instance.lastFrame()?.includes("Agent     opencode healthy") === true,
    );
    expect(instance.lastFrame()).toContain("Name      feature/custom");

    instance.stdin.write("a");
    await waitFor(() => instance.lastFrame()?.includes("› opencode") === true);
    instance.stdin.write("j");
    instance.stdin.write("\r");
    await waitFor(() => instance.lastFrame()?.includes("Agent     codex healthy") === true);

    instance.stdin.write("\r");
    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched).toEqual([
      {
        type: "session.create",
        payload: {
          projectId: "api",
          branch: "feature/custom",
          harness: {
            provider: "codex",
            mode: "interactive",
          },
          terminal: {
            provider: "tmux",
            layout: "agent-build-shell",
            focus: false,
          },
        },
      },
    ]);
    await waitFor(() => instance.lastFrame()?.includes("session.create queued") === true);
    expect(instance.lastFrame()).not.toContain("New Session");
    expect(instance.lastFrame()).not.toContain("creating session...");

    instance.stdin.write("9");
    await settle();
    expect(service.dispatched).toHaveLength(1);

    service.emit({
      type: "worktree.added",
      row: row({
        id: "wt_api_custom",
        projectId: "api",
        branch: "feature/custom",
        state: "none",
      }),
    });
    await waitFor(
      () =>
        instance.lastFrame()?.includes("feature/custom") === true &&
        instance.lastFrame()?.includes("creating session...") === false,
    );
    instance.unmount();
  }, 15_000);

  it("inserts name edits at the arrow-key cursor position", async () => {
    const snapshot = createMultiHarnessSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
    instance.stdin.write("e");
    await waitFor(() => instance.lastFrame()?.includes("Edit Session Name") === true);

    instance.stdin.write("featurefoo");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature|foo") === true);

    instance.stdin.write("/");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature/|foo") === true);
    instance.stdin.write("\u001B[C");
    instance.stdin.write("\u001B[C");
    instance.stdin.write("\u001B[C");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature/foo|") === true);

    instance.stdin.write("-done");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature/foo-done|") === true);
    instance.stdin.write("\r");
    await waitFor(() => instance.lastFrame()?.includes("Name      feature/foo-done") === true);
    instance.stdin.write("\r");

    await waitFor(() => service.dispatched.length === 1);
    expect(service.dispatched[0]).toMatchObject({
      type: "session.create",
      payload: {
        branch: "feature/foo-done",
      },
    });
    instance.unmount();
  }, 15_000);

  it("shows safe errors on command failures after the sheet closes", async () => {
    const snapshot = createMultiHarnessSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
    instance.stdin.write("\r");

    await waitFor(() => instance.lastFrame()?.includes("session.create queued") === true);
    expect(instance.lastFrame()).not.toContain("New Session");
    service.emit({
      type: "command.failed",
      commandId: "cmd_tui_1",
      error: {
        tag: "CommandExecutionError",
        code: "SESSION_CREATE_FAILED",
        message: "Session create failed.",
        diagnosticId: "diag_create_failed",
      },
    });

    await waitFor(
      () =>
        instance.lastFrame()?.includes("Session create failed.") === true &&
        instance.lastFrame()?.includes("creating session...") === false,
    );
    expect(instance.lastFrame()).toContain("diagnostic diag_create_failed");
    instance.unmount();
  });

  it("shows safe errors on rejected dispatch receipts after the sheet closes", async () => {
    const snapshot = createMultiHarnessSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    service.nextReceipt = {
      commandId: "cmd_rejected",
      accepted: false,
      status: "rejected",
      error: {
        tag: "CommandValidationError",
        code: "SESSION_CREATE_REJECTED",
        message: "Session create was rejected.",
      },
    };
    const instance = render(<App initialSnapshot={snapshot} service={service} />);

    instance.stdin.write("N");
    await waitFor(() => instance.lastFrame()?.includes("New Session") === true);
    instance.stdin.write("\r");

    await waitFor(
      () =>
        instance.lastFrame()?.includes("Session create was rejected.") === true &&
        instance.lastFrame()?.includes("New Session") === false &&
        instance.lastFrame()?.includes("creating session...") === false,
    );
    expect(service.dispatched).toHaveLength(1);
    instance.unmount();
  });
});

function createMultiHarnessSnapshot(): WosmSnapshot {
  const snapshot = createDashboardSnapshot();
  return {
    ...snapshot,
    harnesses: [
      { id: "codex", label: "codex" },
      { id: "opencode", label: "opencode" },
      { id: "scripted", label: "scripted" },
    ],
    providerHealth: {
      ...snapshot.providerHealth,
      codex: harnessHealth("codex", snapshot.generatedAt),
      opencode: harnessHealth("opencode", snapshot.generatedAt),
      scripted: harnessHealth("scripted", snapshot.generatedAt),
    },
  };
}

function harnessHealth(providerId: string, lastCheckedAt: string): ProviderHealth {
  return {
    providerId,
    providerType: "harness",
    status: "healthy",
    lastCheckedAt,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
