// ADAPTED from apps/tui/src/state/store.test.ts — see ../PROVENANCE.md.
// The upstream suite's first seven cases assert @wosm/client runtime behavior
// (event subscriptions, live event reduction, connect-failure hooks). Station
// feeds the store from a StationWosmStateSource instead, so those cases are
// rewritten against source semantics (same names, same observable claims
// where one exists). The command.failed-event toast case is dropped: event
// reduction happens inside the source's client runtime in Station. The
// folder-service/addProject and scroll cases are upstream-verbatim plus the
// required `source` option.
import type { SafeError, WosmSnapshot } from "@wosm/contracts";
import { describe, expect, it } from "bun:test";
import {
  createCommandSnapshot,
  createDashboardSnapshot,
  createNoProjectsSnapshot,
  createZeroWorktreeSnapshot,
} from "../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../test/support/fakeObserverService.js";
import { FakeStationSource } from "../../test/support/fakeStationSource.js";
import type { TuiFolderService } from "../services/folderService.js";
import { createTuiStore, type TuiStore } from "./store.js";

describe("TUI store", () => {
  it("loads the source snapshot into state and detaches cleanly", () => {
    const snapshot = createCommandSnapshot("idle");
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    expect(store.getState().snapshot?.rows).toHaveLength(1);
    expect(store.getState().loading).toBe(false);

    stop();
    source.setSnapshot(createZeroWorktreeSnapshot());
    expect(store.getState().snapshot?.rows).toHaveLength(1);
  });

  it("applies source updates to rendered state", () => {
    const snapshot = createCommandSnapshot("idle");
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    const updated: WosmSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map((row) => ({
        ...row,
        display: { ...row.display, statusLabel: "working" },
      })),
    };
    source.setSnapshot(updated);

    expect(store.getState().snapshot?.rows[0]?.display.statusLabel).toBe("working");
    stop();
  });

  it("marks an existing snapshot as display-only on observer connect failures without a toast", () => {
    const snapshot = createCommandSnapshot("idle");
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    source.setConnection({
      state: "reconnecting",
      since: Date.now(),
      lastError: connectSafeError(),
    });

    expect(store.getState().observerConnectionStatus.state).toBe("displayOnly");
    expect(store.getState().snapshot?.rows).toHaveLength(1);
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("marks cold starts as reconnecting on observer connect failures without a toast", () => {
    const source = new FakeStationSource(undefined, {
      state: "reconnecting",
      since: Date.now(),
      lastError: connectSafeError(),
    });
    const service = new FakeTuiObserverService(createCommandSnapshot("idle"));
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    expect(store.getState().observerConnectionStatus.state).toBe("reconnecting");
    expect(store.getState().snapshot).toBeUndefined();
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("clears reconnect status after a successful snapshot and shows delayed recovery feedback", () => {
    const snapshot = createCommandSnapshot("idle");
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    store.setState({
      observerConnectionStatus: {
        state: "displayOnly",
        since: Date.now() - 1_501,
        lastError: connectSafeError(),
      },
    });
    source.setConnection({ state: "connected", since: Date.now() });

    expect(store.getState().observerConnectionStatus.state).toBe("connected");
    expect(
      store.getState().toasts.some((entry) => entry.toast.message === "Observer reconnected."),
    ).toBe(true);
    stop();
  });

  it("does not show recovery feedback for brief reconnect states", () => {
    const snapshot = createCommandSnapshot("idle");
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({ source, service });
    const stop = store.getState().start();

    store.setState({
      observerConnectionStatus: {
        state: "displayOnly",
        since: Date.now() - 100,
        lastError: connectSafeError(),
      },
    });
    source.setConnection({ state: "connected", since: Date.now() });

    expect(store.getState().observerConnectionStatus.state).toBe("connected");
    expect(store.getState().toasts).toEqual([]);
    stop();
  });

  it("syncs terminal rows into view state and clamps dashboard scroll", () => {
    const snapshot = createDashboardSnapshot();
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const store = createTuiStore({
      source,
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
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      source,
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
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      source,
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
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      source,
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
    const source = new FakeStationSource(snapshot);
    const service = new FakeTuiObserverService(snapshot);
    const folderService = fakeFolderService();
    const store = createTuiStore({
      source,
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

function connectSafeError(): SafeError {
  return {
    tag: "ProtocolError",
    code: "PROTOCOL_CONNECT_FAILED",
    message: "Could not connect to observer socket /tmp/wosm-test.sock.",
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  for (;;) {
    if (assertion()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for assertion");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
