import type { WosmEvent } from "@wosm/contracts";
import { describe, it } from "vitest";
import { createCommandSnapshot } from "../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../test/support/fakeObserverService.js";
import { createTuiStore } from "./store.js";

describe("TUI store", () => {
  it("loads initial snapshots and cleans up event subscriptions", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ service });
    const stop = store.getState().start();

    await waitFor(() => store.getState().snapshot?.rows.length === 1);
    await waitFor(() => service.subscribeCount === 1);
    stop();
    await waitFor(() => service.cleanupCount === 1);
  });

  it("applies live events to rendered state", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ service });
    const stop = store.getState().start();
    const event: WosmEvent = {
      type: "worktree.updated",
      worktreeId: "wt_web_idle",
      patch: {
        display: {
          statusLabel: "working",
          sortPriority: 30,
          alert: false,
          reason: "Harness reported active generation.",
        },
      },
    };

    await waitFor(() => service.subscribeCount === 1);
    service.emit(event);

    await waitFor(() => store.getState().snapshot?.rows[0]?.display.statusLabel === "working");
    stop();
  });

  it("removes worktree rows and surfaces command failure toasts from observer events", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ service, initialSnapshot: snapshot });
    const stop = store.getState().start();

    await waitFor(() => service.subscribeCount === 1);
    service.emit({ type: "worktree.removed", worktreeId: "wt_web_idle" });
    service.emit({
      type: "command.failed",
      commandId: "cmd_focus_1",
      error: {
        tag: "TerminalProviderError",
        code: "TERMINAL_TARGET_MISSING",
        message: "The terminal target for this worktree no longer exists.",
        diagnosticId: "diag_terminal_missing",
      },
    });

    await waitFor(
      () =>
        store.getState().snapshot?.rows.length === 0 &&
        store.getState().toasts.some((toast) => toast.diagnosticId === "diag_terminal_missing"),
    );
    stop();
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  for (;;) {
    if (assertion()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for assertion");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
