import type { SafeError, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { describe, expect, it } from "vitest";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
  createNoProjectsSnapshot,
  createZeroWorktreeSnapshot,
} from "../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../test/support/fakeObserverService.js";
import type { TuiFolderService } from "../services/folderService.js";
import type { TuiObserverService } from "../services/types.js";
import { createTuiStore, type TuiStore } from "./store.js";

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
        store
          .getState()
          .toasts.some((entry) => entry.toast.diagnosticId === "diag_terminal_missing"),
    );
    stop();
  });

  it("marks an existing snapshot as display-only on observer connect failures without a toast", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new SnapshotConnectFailingService(snapshot);
    const store = createTuiStore({ service, initialSnapshot: snapshot });
    const stop = store.getState().start();

    await waitFor(() => service.subscribeCount === 1);
    service.failSubscriptions(wrappedConnectError());

    await waitFor(() => store.getState().observerConnectionStatus.state === "displayOnly");
    expect(store.getState().snapshot?.rows).toHaveLength(1);
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("marks cold starts as reconnecting on observer connect failures without a toast", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new ColdStartConnectFailingService(snapshot);
    const store = createTuiStore({ service });
    const stop = store.getState().start();

    await waitFor(() => store.getState().observerConnectionStatus.state === "reconnecting");
    expect(store.getState().snapshot).toBeUndefined();
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("clears reconnect status after a successful snapshot and shows delayed recovery feedback", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ service, initialSnapshot: snapshot });
    const stop = store.getState().start();

    await waitFor(() => service.subscribeCount === 1);
    store.setState({
      observerConnectionStatus: {
        state: "displayOnly",
        since: Date.now() - 1_501,
        lastError: connectSafeError(),
      },
    });
    service.endSubscriptions();

    await waitFor(
      () =>
        store.getState().observerConnectionStatus.state === "connected" &&
        store.getState().toasts.some((entry) => entry.toast.message === "Observer reconnected."),
    );
    stop();
  });

  it("does not show recovery feedback for brief reconnect states", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ service, initialSnapshot: snapshot });
    const stop = store.getState().start();

    await waitFor(() => service.subscribeCount === 1);
    store.setState({
      observerConnectionStatus: {
        state: "displayOnly",
        since: Date.now() - 100,
        lastError: connectSafeError(),
      },
    });
    service.endSubscriptions();

    await waitFor(() => store.getState().observerConnectionStatus.state === "connected");
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("syncs terminal rows into view state and clamps dashboard scroll", () => {
    const snapshot = createDashboardSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({
      service,
      initialSnapshot: snapshot,
      initialState: {
        scrollOffset: 8,
        terminalRows: 10,
      },
    });

    store.getState().setTerminalRows(24);

    expect(store.getState().terminalRows).toBe(24);
    expect(store.getState().scrollOffset).toBe(0);
  });

  it("uses the local folder service and dispatches project.add after confirmation", async () => {
    const snapshot = createNoProjectsSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      service,
      initialSnapshot: snapshot,
      folderService,
    });

    store.getState().handleKey({ input: "A" });
    expect(store.getState().screen).toMatchObject({ name: "addProject" });

    store.getState().handleKey({ input: "", rightArrow: true });
    await waitFor(() => screenMode(store.getState()) === "choose");
    expect(folderService.reads).toEqual(["/Users/example/Developer/wosm"]);

    store.getState().handleKey({ input: "", downArrow: true });
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "review");

    store.getState().handleKey({ input: "N" });
    store.getState().handleKey({ input: "-custom" });
    store.getState().handleKey({ input: "\r", return: true });

    service.setSnapshot(createZeroWorktreeSnapshot());
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "success");

    expect(service.dispatched).toEqual([
      {
        type: "project.add",
        payload: {
          path: "/Users/example/Developer/wosm",
          id: "wosm-custom",
          label: "wosm",
        },
      },
    ]);
    expect(service.waitedForCommandIds).toEqual(["cmd_tui_1"]);
  });

  it("reviews a pasted full path when folder filtering has no matches", async () => {
    const snapshot = createNoProjectsSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      service,
      initialSnapshot: snapshot,
      folderService,
    });

    store.getState().handleKey({ input: "A" });
    store.getState().handleKey({ input: "", rightArrow: true });
    await waitFor(() => screenMode(store.getState()) === "choose");

    store.getState().handleKey({ input: "/" });
    store.getState().handleKey({ input: "/Users/example/Developer/synth" });
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "review");

    expect(folderService.reviews).toEqual(["/Users/example/Developer/synth"]);
    expect(store.getState().screen).toMatchObject({
      name: "addProject",
      flow: {
        mode: "review",
        selectedPath: "/Users/example/Developer/synth",
        id: "synth",
        label: "synth",
      },
    });
  });

  it("opens the home anchor from start choices", async () => {
    const snapshot = createNoProjectsSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      service,
      initialSnapshot: snapshot,
      folderService,
    });

    store.getState().handleKey({ input: "A" });
    store.getState().handleKey({ input: "", downArrow: true });
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "choose");

    expect(folderService.reads).toEqual(["/Users/example"]);
    expect(store.getState().screen).toMatchObject({
      name: "addProject",
      flow: {
        mode: "choose",
        currentPath: "/Users/example",
      },
    });
  });

  it("globally searches likely project roots from slash mode", async () => {
    const snapshot = createNoProjectsSnapshot();
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      service,
      initialSnapshot: snapshot,
      folderService,
    });

    store.getState().handleKey({ input: "A" });
    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "choose");

    store.getState().handleKey({ input: "/" });
    store.getState().handleKey({ input: "Germ" });
    await waitFor(() => addProjectSearchResultCount(store.getState()) === 1);

    store.getState().handleKey({ input: "\r", return: true });
    await waitFor(() => screenMode(store.getState()) === "review");

    expect(folderService.reviews).toContain("/Users/example/Desktop/projects/GermStack");
  });
});

function fakeFolderService(): TuiFolderService & {
  reads: string[];
  reviews: string[];
  searches: string[];
} {
  const reads: string[] = [];
  const reviews: string[] = [];
  const searches: string[] = [];
  return {
    reads,
    reviews,
    searches,
    cwd: () => "/Users/example/Developer/wosm",
    homeDir: () => "/Users/example",
    parent: (path) => path.split("/").slice(0, -1).join("/") || "/",
    readDirectory: async (path) => {
      reads.push(path);
      return {
        path,
        entries: entriesForPath(path),
      };
    },
    searchDirectories: async (query) => {
      searches.push(query);
      return {
        query,
        truncated: false,
        entries: query.toLowerCase().includes("germ")
          ? [
              {
                name: "GermStack",
                path: "/Users/example/Desktop/projects/GermStack",
                displayPath: "~/Desktop/projects/GermStack",
                kind: "directory",
              },
            ]
          : [],
      };
    },
    reviewFolder: async (path) => {
      reviews.push(path);
      const label = path.split("/").filter(Boolean).at(-1) ?? "project";
      return {
        selectedPath: path,
        gitRoot: path,
        id: label,
        label,
      };
    },
  };
}

function entriesForPath(path: string) {
  if (path === "/Users/example/Desktop/projects") {
    return [
      {
        name: "GermStack",
        path: "/Users/example/Desktop/projects/GermStack",
        kind: "directory" as const,
      },
    ];
  }
  return [
    {
      name: "wosm",
      path: "/Users/example/Developer/wosm",
      kind: "directory" as const,
    },
  ];
}

function screenMode(state: TuiStore) {
  return state.screen.name === "addProject" ? state.screen.flow.mode : undefined;
}

function addProjectSearchResultCount(state: TuiStore) {
  return state.screen.name === "addProject" && state.screen.flow.mode === "choose"
    ? state.screen.flow.searchEntries.length
    : 0;
}

class SnapshotConnectFailingService extends FakeTuiObserverService {
  override async loadSnapshot(): Promise<WosmSnapshot> {
    this.loadCount += 1;
    throw wrappedConnectError();
  }
}

class ColdStartConnectFailingService implements TuiObserverService {
  readonly dispatched = [];
  loadCount = 0;
  subscribeCount = 0;

  constructor(private readonly snapshot: WosmSnapshot) {}

  async loadSnapshot(): Promise<WosmSnapshot> {
    this.loadCount += 1;
    throw wrappedConnectError();
  }

  subscribeEvents(): AsyncIterable<WosmEvent> {
    this.subscribeCount += 1;
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw wrappedConnectError();
        },
        return: async () => ({ done: true, value: undefined }),
      }),
    };
  }

  async dispatch() {
    return {
      commandId: "cmd_tui_1",
      accepted: true,
      status: "accepted" as const,
    };
  }

  async waitForCommandCompletion(commandId: string) {
    return {
      status: "succeeded" as const,
      commandId,
    };
  }

  async reconcile(): Promise<WosmSnapshot> {
    return this.snapshot;
  }
}

function connectSafeError(): SafeError {
  return {
    tag: "ProtocolError",
    code: "PROTOCOL_CONNECT_FAILED",
    message: "Could not connect to observer socket /tmp/wosm-test.sock.",
  };
}

function wrappedConnectError(): Error {
  const error = new Error("wrapped connect failure");
  (error as Error & { cause?: unknown }).cause = connectSafeError();
  return error;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  for (;;) {
    if (assertion()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for assertion");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
