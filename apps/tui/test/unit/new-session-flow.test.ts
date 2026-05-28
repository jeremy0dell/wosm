import { describe, expect, it } from "vitest";
import {
  createNewSessionFlow,
  harnessOptions,
  newSessionIntentForInput,
  transitionNewSessionFlow,
  validateNewSessionCreate,
} from "../../src/flows/newSession.js";
import { createDashboardSnapshot } from "../fixtures/snapshots.js";

describe("new session flow", () => {
  it("defaults to the first configured project and its default agent", () => {
    const state = createNewSessionFlow(createHarnessSnapshot(), "k7p3x9");

    expect(state).toEqual({
      mode: "review",
      selectedProjectId: "web",
      selectedHarness: "codex",
      branch: "web-k7p3x9",
      nameSource: "generated",
      stepHistory: [],
    });
    expect(Object.hasOwn(state ?? {}, "draftName")).toBe(false);
  });

  it("trims typed names and otherwise preserves branch text", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    const editing = transitionNewSessionFlow(opened, snapshot, { type: "editName" });
    if (editing?.mode !== "editName") throw new Error("expected edit mode");

    let state = editing;
    for (const input of " feature/foo ") {
      const next = transitionNewSessionFlow(state, snapshot, { type: "appendName", input });
      if (next?.mode !== "editName") throw new Error("expected edit mode");
      state = next;
    }

    expect(transitionNewSessionFlow(state, snapshot, { type: "commitName" })).toMatchObject({
      mode: "review",
      branch: "feature/foo",
      nameSource: "custom",
    });
  });

  it("keeps input interpretation out of the app input handler", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    expect(newSessionIntentForInput(opened, input("p"))).toEqual({
      type: "transition",
      action: { type: "pickProject" },
    });
    expect(newSessionIntentForInput(opened, input("\r", { return: true }))).toEqual({
      type: "submit",
    });

    const picker = transitionNewSessionFlow(opened, snapshot, { type: "pickAgent" });
    if (picker?.mode !== "pickAgent") throw new Error("expected agent picker");
    expect(newSessionIntentForInput(picker, input("2"))).toEqual({
      type: "transition",
      action: { type: "chooseAgent", index: 1 },
    });
  });

  it("uses wizard history for substep cancellation", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    const editing = transitionNewSessionFlow(opened, snapshot, { type: "editName" });
    expect(editing).toMatchObject({
      mode: "editName",
      stepHistory: ["review"],
      draftName: { value: "", cursor: 0 },
    });

    const reviewed = transitionNewSessionFlow(editing ?? opened, snapshot, { type: "cancel" });
    expect(reviewed).toMatchObject({
      mode: "review",
      stepHistory: [],
    });
  });

  it("resets agent and regenerates generated names when the project changes", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    const picker = transitionNewSessionFlow(opened, snapshot, { type: "pickProject" });
    if (picker?.mode !== "pickProject") throw new Error("expected project picker");
    const moved = transitionNewSessionFlow(picker, snapshot, { type: "moveCursor", delta: 1 });
    const selected = transitionNewSessionFlow(moved ?? picker, snapshot, {
      type: "commitProject",
      token: "bbbbbb",
    });

    expect(selected).toMatchObject({
      mode: "review",
      selectedProjectId: "api",
      selectedHarness: "opencode",
      branch: "api-bbbbbb",
      nameSource: "generated",
    });
  });

  it("keeps custom names when the project changes", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    const custom = {
      ...opened,
      branch: "feature/custom",
      nameSource: "custom" as const,
    };
    const picker = transitionNewSessionFlow(custom, snapshot, { type: "pickProject" });
    if (picker?.mode !== "pickProject") throw new Error("expected project picker");
    const moved = transitionNewSessionFlow(picker, snapshot, { type: "moveCursor", delta: 1 });
    const selected = transitionNewSessionFlow(moved ?? picker, snapshot, {
      type: "commitProject",
      token: "bbbbbb",
    });

    expect(selected).toMatchObject({
      selectedProjectId: "api",
      selectedHarness: "opencode",
      branch: "feature/custom",
      nameSource: "custom",
    });
  });

  it("ignores out-of-range direct project picks", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");
    const picker = transitionNewSessionFlow(opened, snapshot, { type: "pickProject" });
    if (picker?.mode !== "pickProject") throw new Error("expected project picker");

    const intent = newSessionIntentForInput(picker, input("9"));
    if (intent.type !== "transition") throw new Error("expected transition intent");
    const selected = transitionNewSessionFlow(picker, snapshot, intent.action);

    expect(selected).toBe(picker);
  });

  it("ignores out-of-range direct agent picks", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");
    const picker = transitionNewSessionFlow(opened, snapshot, { type: "pickAgent" });
    if (picker?.mode !== "pickAgent") throw new Error("expected agent picker");

    const intent = newSessionIntentForInput(picker, input("9"));
    if (intent.type !== "transition") throw new Error("expected transition intent");
    const selected = transitionNewSessionFlow(picker, snapshot, intent.action);

    expect(selected).toBe(picker);
  });

  it("moves the edit-name cursor and edits at the insertion point", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");
    const editing = transitionNewSessionFlow(opened, snapshot, { type: "editName" });
    if (editing?.mode !== "editName") throw new Error("expected edit mode");

    const typed = typeName(editing, snapshot, "feature/foo");
    const movedLeft = transitionNewSessionFlow(typed, snapshot, {
      type: "moveNameCursor",
      delta: -3,
    });
    if (movedLeft?.mode !== "editName") throw new Error("expected edit mode");
    expect(movedLeft.draftName.cursor).toBe(8);

    const inserted = transitionNewSessionFlow(movedLeft, snapshot, {
      type: "appendName",
      input: "-bar",
    });
    expect(inserted).toMatchObject({
      mode: "editName",
      draftName: {
        value: "feature/-barfoo",
        cursor: 12,
      },
    });

    const backspaced = transitionNewSessionFlow(inserted ?? movedLeft, snapshot, {
      type: "backspaceName",
    });
    expect(backspaced).toMatchObject({
      mode: "editName",
      draftName: {
        value: "feature/-bafoo",
        cursor: 11,
      },
    });

    const deleted = transitionNewSessionFlow(backspaced ?? movedLeft, snapshot, {
      type: "deleteName",
    });
    expect(deleted).toMatchObject({
      mode: "editName",
      draftName: {
        value: "feature/-baoo",
        cursor: 11,
      },
    });
  });

  it("maps left and right arrows to edit-name cursor movement", () => {
    const snapshot = createHarnessSnapshot();
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");
    const editing = transitionNewSessionFlow(opened, snapshot, { type: "editName" });
    if (editing?.mode !== "editName") throw new Error("expected edit mode");

    expect(newSessionIntentForInput(editing, input("", { leftArrow: true }))).toEqual({
      type: "transition",
      action: { type: "moveNameCursor", delta: -1 },
    });
    expect(newSessionIntentForInput(editing, input("", { rightArrow: true }))).toEqual({
      type: "transition",
      action: { type: "moveNameCursor", delta: 1 },
    });
  });

  it("orders agent options with the selected project default first", () => {
    const snapshot = createHarnessSnapshot();
    const api = snapshot.projects.find((project) => project.id === "api");
    if (api === undefined) throw new Error("missing api project");

    expect(harnessOptions(snapshot, api).map((option) => option.id)).toEqual([
      "opencode",
      "codex",
      "scripted",
    ]);
  });

  it("blocks unavailable agents while allowing degraded and unknown agents", () => {
    const snapshot = createHarnessSnapshot({
      codex: "unavailable",
      opencode: "degraded",
    });
    const opened = createNewSessionFlow(snapshot, "aaaaaa");
    if (opened === undefined) throw new Error("expected a flow");

    expect(validateNewSessionCreate(snapshot, opened)).toMatchObject({
      ok: false,
      error: {
        code: "HARNESS_PROVIDER_UNAVAILABLE",
      },
    });

    const opencode = { ...opened, selectedHarness: "opencode" };
    expect(validateNewSessionCreate(snapshot, opencode)).toMatchObject({
      ok: true,
      harnessProvider: "opencode",
    });

    const unknown = { ...opened, selectedHarness: "scripted" };
    expect(validateNewSessionCreate(snapshot, unknown)).toMatchObject({
      ok: true,
      harnessProvider: "scripted",
    });
  });
});

function createHarnessSnapshot(
  statuses: Partial<
    Record<"codex" | "opencode" | "scripted", "healthy" | "degraded" | "unavailable">
  > = {},
) {
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
      codex: harnessHealth("codex", statuses.codex ?? "healthy", snapshot.generatedAt),
      opencode: harnessHealth("opencode", statuses.opencode ?? "healthy", snapshot.generatedAt),
    },
  };
}

function typeName(
  initialState: NonNullable<ReturnType<typeof transitionNewSessionFlow>> & { mode: "editName" },
  snapshot: ReturnType<typeof createHarnessSnapshot>,
  value: string,
) {
  return value.split("").reduce((state, input) => {
    const next = transitionNewSessionFlow(state, snapshot, { type: "appendName", input });
    if (next?.mode !== "editName") throw new Error("expected edit mode");
    return next;
  }, initialState);
}

function input(
  value: string,
  key: Parameters<typeof newSessionIntentForInput>[1]["key"] = {},
): Parameters<typeof newSessionIntentForInput>[1] {
  return {
    input: value,
    key,
    token: "bbbbbb",
  };
}

function harnessHealth(
  providerId: string,
  status: "healthy" | "degraded" | "unavailable",
  lastCheckedAt: string,
) {
  return {
    providerId,
    providerType: "harness" as const,
    status,
    lastCheckedAt,
  };
}
