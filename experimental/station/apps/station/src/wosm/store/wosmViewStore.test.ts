import { describe, expect, it } from "bun:test";
import type { StoreApi } from "zustand/vanilla";
import { selectDashboardViewport } from "../ported/selectors/dashboardViewport.js";
import type { TuiFolderService } from "../ported/services/folderService.js";
import type { TuiStore } from "../ported/state/store.js";
import { waitFor } from "../../terminal/testing/waitFor.js";
import { manyProjectsSnapshot } from "../fixtures/scenarios.js";
import { FakeStationSource } from "../test/support/fakeStationSource.js";
import { createStationStubObserverService } from "./stubObserverService.js";
import { createWosmViewStore } from "./wosmViewStore.js";

describe("createWosmViewStore", () => {
  it("routes row activation through the stubbed command service with real pending state", async () => {
    const store = makeStore();
    const slot = slotForRow(store, "wt_wosm_none");

    store.getState().handleKey({ input: slot });

    expect(store.getState().localRows.pendingStart).toMatchObject([
      {
        localId: "start:wt_wosm_none",
        worktreeId: "wt_wosm_none",
        branch: "docs-cleanup",
      },
    ]);
    await waitForStationDispatchPendingToast(store);
  });

  it("routes N through create-session pending state and stub rejection feedback", async () => {
    const store = makeStore();

    store.getState().handleKey({ input: "N" });
    store.getState().handleKey({ input: "\r", return: true });

    expect(store.getState().localRows.pendingCreate).toHaveLength(1);
    expect(store.getState().localRows.pendingCreate[0]).toMatchObject({
      projectId: "wosm",
      harnessProvider: "codex",
    });
    await waitForStationDispatchPendingToast(store);
  });

  it("routes A through add-project dispatch and stub rejection feedback", async () => {
    const store = makeStore(fakeFolderService());

    store.getState().handleKey({ input: "A" });
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => addProjectScreenMode(store) === "choose");
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => addProjectScreenMode(store) === "review");
    store.getState().handleKey({ input: "\r", return: true });

    await waitFor(() => addProjectFailureMessage(store).includes("Station command dispatch"));
  });

  it("routes X through remove pending state and stub rejection feedback", async () => {
    const store = makeStore();
    const slot = slotForRow(store, "wt_wosm_idle");

    store.getState().handleKey({ input: "X" });
    store.getState().handleKey({ input: slot });
    store.getState().handleKey({ input: "y" });

    expect(store.getState().localRows.pendingRemove).toMatchObject([
      {
        localId: "remove:wt_wosm_idle",
        worktreeId: "wt_wosm_idle",
        branch: "pty-buffer",
      },
    ]);
    await waitForStationDispatchPendingToast(store);
  });

  it("routes R through rename pending state and stub rejection feedback", async () => {
    const store = makeStore();
    const slot = slotForRow(store, "wt_wosm_idle");

    store.getState().handleKey({ input: "R" });
    store.getState().handleKey({ input: slot });
    store.getState().handleKey({ input: "x" });
    store.getState().handleKey({ input: "\r", return: true });

    expect(store.getState().localRows.pendingRenameTitles?.ses_wt_wosm_idle).toMatchObject({
      title: "pty-bufferx",
    });
    await waitForStationDispatchPendingToast(store);
  });

  it("routes Z through reconcile and stub rejection feedback", async () => {
    const store = makeStore();

    store.getState().handleKey({ input: "Z" });

    await waitForStationDispatchPendingToast(store);
  });
});

function makeStore(folderService?: TuiFolderService): StoreApi<TuiStore> {
  const snapshot = manyProjectsSnapshot();
  const source = new FakeStationSource(snapshot);
  const options: Parameters<typeof createWosmViewStore>[1] = {
  };
  if (folderService !== undefined) {
    options.folderService = folderService;
  }
  const store = createWosmViewStore(
    {
      state: source,
      service: createStationStubObserverService(source, { dispatchDelayMs: 1 }),
      start: () => {
        source.start();
      },
      stop: () => source.stop(),
    },
    options,
  );
  store.getState().start();
  return store;
}

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

async function waitForStationDispatchPendingToast(store: StoreApi<TuiStore>): Promise<void> {
  await waitFor(() =>
    store
      .getState()
      .toasts.some((entry) => entry.toast.message.includes("Station command dispatch")),
  );
}

function addProjectScreenMode(store: StoreApi<TuiStore>): string | undefined {
  const screen = store.getState().screen;
  return screen.name === "addProject" ? screen.flow.mode : undefined;
}

function addProjectFailureMessage(store: StoreApi<TuiStore>): string {
  const screen = store.getState().screen;
  return screen.name === "addProject" && screen.flow.mode === "failed"
    ? screen.flow.error.message
    : "";
}

function fakeFolderService(): TuiFolderService {
  return {
    cwd: () => "/Users/example/Developer/wosm",
    homeDir: () => "/Users/example",
    parent: (path) => path.split("/").slice(0, -1).join("/") || "/",
    readDirectory: async (path) => ({
      path,
      entries: [
        {
          name: "wosm",
          path: "/Users/example/Developer/wosm",
          kind: "directory",
        },
      ],
    }),
    searchDirectories: async (query) => ({ query, entries: [], truncated: false }),
    reviewFolder: async (path) => ({
      selectedPath: path,
      gitRoot: path,
      id: "wosm",
      label: "wosm",
    }),
  };
}
