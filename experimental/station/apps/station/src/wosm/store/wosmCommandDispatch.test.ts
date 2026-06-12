// The PR 4 proof: Station commands flow through the one shared @wosm/client
// boundary. Dispatch and completion waits pass through to the observer
// service, while reconcile and snapshot loads route through the client
// runtime — so the runtime's reducer base stays converged with the store and
// the connected transition plus recovery toast arrive via the state
// subscription (the seam from PR #78 review finding #3).
import type { WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { afterEach, describe, expect, it } from "bun:test";
import type { StoreApi } from "zustand/vanilla";
import { selectDashboardViewport, type TuiStore } from "@wosm/dashboard-core";
import { createObserverWosmClient } from "../../sources/observerWosmClient.js";
import type { StationWosmClient } from "../../sources/types.js";
import { waitFor } from "../../terminal/testing/waitFor.js";
import { manyProjectsSnapshot } from "../fixtures/scenarios.js";
import { routeWosmMouse } from "../input/wosmMouse.js";
import { FakeTuiObserverService } from "../test/support/fakeObserverService.js";
import { createWosmViewStore } from "./wosmViewStore.js";

describe("station command dispatch through the shared client", () => {
  const harnesses: Harness[] = [];

  afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
      harness.fake.resumeLoadSnapshot();
      harness.detach();
      await harness.client.stop();
    }
  });

  async function makeLiveStore(): Promise<Harness> {
    const fake = new FakeTuiObserverService(manyProjectsSnapshot());
    const client = createObserverWosmClient({ service: fake });
    const store = createWosmViewStore(client);
    const detach = store.getState().start();
    client.start();
    const harness: Harness = { fake, client, store, detach };
    harnesses.push(harness);
    await waitFor(
      () =>
        client.state.getState().connection.state === "connected" &&
        store.getState().snapshot !== undefined,
    );
    return harness;
  }

  it("row activation dispatches terminal.focus and waits for completion", async () => {
    const { fake, store } = await makeLiveStore();
    const slot = slotForRow(store, "wt_wosm_idle");

    store.getState().handleKey({ input: slot });

    await waitFor(() => fake.waitedForCommandIds.length === 1);
    expect(fake.dispatched).toEqual([
      { type: "terminal.focus", payload: { sessionId: "ses_wt_wosm_idle" } },
    ]);
    expect(fake.waitedForCommandIds).toEqual([fake.nextReceipt.commandId]);
    expect(errorToastMessages(store)).toEqual([]);
  });

  it("jump-to-session by row click dispatches the same focus command", async () => {
    const { fake, store } = await makeLiveStore();

    const outcome = routeWosmMouse({ kind: "row", rowId: "wt_wosm_idle" }, "down", store);

    expect(outcome).toEqual({ kind: "handled" });
    await waitFor(() => fake.waitedForCommandIds.length === 1);
    expect(fake.dispatched).toEqual([
      { type: "terminal.focus", payload: { sessionId: "ses_wt_wosm_idle" } },
    ]);
    expect(errorToastMessages(store)).toEqual([]);
  });

  it("routes Z refresh through the client runtime", async () => {
    const { fake, client, store } = await makeLiveStore();
    const reconciled: WosmSnapshot = {
      ...manyProjectsSnapshot(),
      generatedAt: RECONCILED_AT,
    };
    fake.setSnapshot(reconciled);

    store.getState().handleKey({ input: "Z" });

    await waitFor(() => toastMessages(store).includes("observer.reconcile refreshed"));
    expect(fake.reconcileReasons).toEqual(["tui-refresh"]);
    expect(client.state.getState().snapshot).toBe(reconciled);
    expect(store.getState().snapshot?.generatedAt).toBe(RECONCILED_AT);
  });

  it("keeps reconciled state when a later incremental event arrives", async () => {
    const { fake, store } = await makeLiveStore();
    const reconciled: WosmSnapshot = {
      ...manyProjectsSnapshot(),
      generatedAt: RECONCILED_AT,
    };
    fake.setSnapshot(reconciled);
    store.getState().handleKey({ input: "Z" });
    await waitFor(() => store.getState().snapshot?.generatedAt === RECONCILED_AT);

    fake.emit(rowUpdateEvent("wt_wosm_idle"));

    // Pre-fix, the runtime reduced this event against its stale pre-reconcile
    // base and the mirror reverted the reconciled snapshot in the store.
    await waitFor(() => rowStatusLabel(store, "wt_wosm_idle") === "working");
    expect(store.getState().snapshot?.generatedAt).toBe(RECONCILED_AT);
  });

  it("shows the reconcile failure toast and clears loading", async () => {
    const { fake, store } = await makeLiveStore();
    fake.nextReconcileError = new Error("reconcile exploded");

    store.getState().handleKey({ input: "Z" });

    await waitFor(() => store.getState().toasts.length > 0);
    expect(store.getState().toasts[0]?.toast.kind).toBe("error");
    expect(store.getState().loading).toBe(false);
    expect(toastMessages(store)).not.toContain("observer.reconcile refreshed");
  });

  it("reconcile recovery flips the store to connected with the reconnect toast", async () => {
    const { fake, store } = await makeLiveStore();

    // Park the resubscribed cycle's resync so the subscription is live while
    // the store still shows displayOnly; the Z reconcile is then what proves
    // the resync and produces the connected transition.
    fake.pauseLoadSnapshot();
    fake.failSubscriptions(wrappedConnectError());
    await waitFor(() => store.getState().observerConnectionStatus.state === "displayOnly");
    await waitFor(() => fake.subscribeCount >= 2);

    const current = store.getState().observerConnectionStatus;
    if (current.state !== "displayOnly") {
      throw new Error("expected a displayOnly connection status");
    }
    // Backdate the outage past the recovery-toast threshold.
    store.setState({
      observerConnectionStatus: { ...current, since: Date.now() - 3_000 },
    });

    store.getState().handleKey({ input: "Z" });

    await waitFor(() => store.getState().observerConnectionStatus.state === "connected");
    await waitFor(() => toastMessages(store).includes("Observer reconnected."));
    expect(toastMessages(store)).toContain("observer.reconcile refreshed");
    expect(store.getState().snapshot !== undefined).toBe(true);
  });
});

const RECONCILED_AT = "2026-06-12T12:30:00.000Z";

type Harness = {
  fake: FakeTuiObserverService;
  client: StationWosmClient;
  store: StoreApi<TuiStore>;
  detach(): void;
};

function slotForRow(store: StoreApi<TuiStore>, rowId: string): string {
  const state = store.getState();
  if (state.snapshot === undefined) {
    throw new Error("store has no snapshot");
  }
  const choice = selectDashboardViewport(state.snapshot, state).rowChoices.find(
    (candidate) => candidate.value.id === rowId,
  );
  if (choice === undefined) {
    throw new Error(`no slot for row ${rowId}`);
  }
  return choice.key;
}

function toastMessages(store: StoreApi<TuiStore>): string[] {
  return store.getState().toasts.map((entry) => entry.toast.message);
}

function errorToastMessages(store: StoreApi<TuiStore>): string[] {
  return store
    .getState()
    .toasts.filter((entry) => entry.toast.kind === "error")
    .map((entry) => entry.toast.message);
}

function rowStatusLabel(store: StoreApi<TuiStore>, rowId: string): string | undefined {
  return store.getState().snapshot?.rows.find((row) => row.id === rowId)?.display.statusLabel;
}

function rowUpdateEvent(worktreeId: string): WosmEvent {
  return {
    type: "worktree.updated",
    worktreeId,
    patch: {
      display: {
        statusLabel: "working",
        sortPriority: 30,
        alert: false,
        reason: "Live event after reconcile.",
      },
    },
  };
}

function wrappedConnectError(): Error {
  const error = new Error("wrapped connect failure");
  (error as Error & { cause?: unknown }).cause = {
    tag: "ProtocolError",
    code: "PROTOCOL_CONNECT_FAILED",
    message: "Could not connect to the observer socket.",
  };
  return error;
}
