import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../../../test/fixtures/snapshots.js";
import { createNewSessionFlow, transitionNewSessionFlow } from "../../../flows/newSession.js";
import { newSessionBottomSheetLayout } from "../layout.js";
import { NewSessionBottomSheet } from "../NewSessionBottomSheet.js";

describe("NewSessionBottomSheet", () => {
  it("hugs the bottom of the terminal frame", () => {
    const snapshot = createDashboardSnapshot();
    const state = createNewSessionFlow(snapshot, "k7p3x9");
    if (state === undefined) throw new Error("expected a flow");

    const layout = newSessionBottomSheetLayout({
      columns: 72,
      rows: 18,
      state,
      optionCount: 0,
    });
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={72} height={18}>
          <NewSessionBottomSheet columns={72} rows={18} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 72 },
      ),
    );
    const lines = frame.split("\n");

    expect(layout.top).toBe(8);
    expect(lines).toHaveLength(18);
    expect(lines.slice(0, layout.top).join("").trim()).toBe("");
    expect(lines[layout.top]).toContain("╭");
    expect(frame).toContain("New Session");
    expect(frame).toContain("Project   web");
    expect(frame).toContain("Name      web-k7p3x9");
    expect(frame).toContain("Agent     codex unknown");
    expect(frame).not.toContain("|");
  });

  it("renders project and agent picker modes without owning input behavior", () => {
    const snapshot = {
      ...createDashboardSnapshot(),
      harnesses: [
        { id: "codex", label: "codex" },
        { id: "opencode", label: "opencode" },
      ],
    };
    const review = createNewSessionFlow(snapshot, "aaaaaa");
    if (review === undefined) throw new Error("expected a flow");
    const projectPicker = transitionNewSessionFlow(review, snapshot, { type: "pickProject" });
    const agentPicker = transitionNewSessionFlow(review, snapshot, { type: "pickAgent" });
    if (projectPicker === undefined || agentPicker === undefined) {
      throw new Error("expected picker states");
    }

    const projectFrame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={projectPicker} />
        </Box>,
        { columns: 80 },
      ),
    );
    const agentFrame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={agentPicker} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(projectFrame).toContain("› web");
    expect(projectFrame).toContain("  api");
    expect(projectFrame).toContain("Enter:select Esc:cancel");
    expect(agentFrame).toContain("› codex");
    expect(agentFrame).toContain("default unknown");
    expect(agentFrame).toContain("  opencode");
    expect(agentFrame).toContain("Enter:select Esc:cancel");
  });

  it("keeps the picker footer visible with eight project options", () => {
    const snapshot = createProjectOptionSnapshot(8);
    const state = createProjectPickerState(snapshot);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).toContain("Project 01");
    expect(frame).toContain("Project 08");
    expect(frame).toContain("Enter:select Esc:cancel");
  });

  it("windows long project pickers around the active cursor", () => {
    const snapshot = createProjectOptionSnapshot(10);
    const state = createProjectPickerState(snapshot, 9);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).not.toContain("Project 01");
    expect(frame).not.toContain("Project 02");
    expect(frame).toContain("Project 03");
    expect(frame).toContain("› Project 10");
    expect(frame).toContain("Enter:select Esc:cancel");
  });

  it("windows long agent pickers around the active cursor", () => {
    const snapshot = createHarnessOptionSnapshot(10);
    const state = createAgentPickerState(snapshot, 9);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).not.toContain("Agent 01");
    expect(frame).not.toContain("Agent 02");
    expect(frame).toContain("Agent 03");
    expect(frame).toContain("› Agent 10");
    expect(frame).toContain("Enter:select Esc:cancel");
  });

  it("renders edit-name mode with the cursor before the generated fallback", () => {
    const snapshot = createDashboardSnapshot();
    const review = createNewSessionFlow(snapshot, "k7p3x9");
    if (review === undefined) throw new Error("expected a flow");
    const editName = transitionNewSessionFlow(review, snapshot, { type: "editName" });
    if (editName?.mode !== "editName") throw new Error("expected edit-name state");

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={72} height={16}>
          <NewSessionBottomSheet columns={72} rows={16} snapshot={snapshot} state={editName} />
        </Box>,
        { columns: 72 },
      ),
    );

    expect(frame).toContain("Edit Session Name");
    expect(frame).toContain("Project   web");
    expect(frame).toContain("Name      |web-k7p3x9");
    expect(frame).toContain("Enter:use generated name   Esc:back");
    expect(frame).not.toContain("Agent     codex");
    expect(frame).not.toContain("Enter:create");
  });

  it("renders the edit-name cursor after typed draft text", () => {
    const snapshot = createDashboardSnapshot();
    const review = createNewSessionFlow(snapshot, "k7p3x9");
    if (review === undefined) throw new Error("expected a flow");
    const editName = transitionNewSessionFlow(review, snapshot, { type: "editName" });
    if (editName?.mode !== "editName") throw new Error("expected edit-name state");
    const typed = "feature/foo".split("").reduce((state, input) => {
      const next = transitionNewSessionFlow(state, snapshot, { type: "appendName", input });
      if (next?.mode !== "editName") throw new Error("expected edit-name state");
      return next;
    }, editName);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={72} height={16}>
          <NewSessionBottomSheet columns={72} rows={16} snapshot={snapshot} state={typed} />
        </Box>,
        { columns: 72 },
      ),
    );

    expect(frame).toContain("Name      feature/foo|");
    expect(frame).toContain("Enter:use name   Esc:back");
  });

  it("paints full interior rows over dashboard divider characters", () => {
    const snapshot = createDashboardSnapshot();
    const state = createNewSessionFlow(snapshot, "jjj3m5");
    if (state === undefined) throw new Error("expected a flow");

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={54} height={10}>
          {backgroundRows().map((key) => (
            <Text key={key}>{"─".repeat(54)}</Text>
          ))}
          <NewSessionBottomSheet columns={54} rows={10} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 54 },
      ),
    );

    expect(frame).toContain("E:edit name   P:project   A:agent   Esc:cancel");
    const shortcutLine = frame.split("\n").find((line) => line.includes("E:edit name   P:project"));
    expect(shortcutLine).toContain("│ E:edit");
    expect(shortcutLine).not.toContain("─E:edit");
    expect(shortcutLine).not.toContain("Esc:cancel──");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function createProjectPickerState(snapshot: WosmSnapshot, cursor = 0) {
  const review = createNewSessionFlow(snapshot, "aaaaaa");
  if (review === undefined) throw new Error("expected a flow");
  const state = transitionNewSessionFlow(review, snapshot, { type: "pickProject" });
  if (state?.mode !== "pickProject") throw new Error("expected project picker");
  return {
    ...state,
    cursor,
  };
}

function createAgentPickerState(snapshot: WosmSnapshot, cursor = 0) {
  const review = createNewSessionFlow(snapshot, "aaaaaa");
  if (review === undefined) throw new Error("expected a flow");
  const state = transitionNewSessionFlow(review, snapshot, { type: "pickAgent" });
  if (state?.mode !== "pickAgent") throw new Error("expected agent picker");
  return {
    ...state,
    cursor,
  };
}

function createProjectOptionSnapshot(count: number): WosmSnapshot {
  const snapshot = createDashboardSnapshot();
  const baseProject = snapshot.projects[0];
  if (baseProject === undefined) throw new Error("expected a project");
  const projects = Array.from({ length: count }, (_, index): ProjectView => {
    const optionNumber = String(index + 1).padStart(2, "0");
    return {
      ...baseProject,
      id: `project-${optionNumber}`,
      label: `Project ${optionNumber}`,
      root: `/tmp/wosm/project-${optionNumber}`,
      defaults: {
        ...baseProject.defaults,
        harness: "codex",
      },
      counts: emptyProjectCounts(),
    };
  });
  return {
    ...snapshot,
    projects,
    rows: [],
    sessions: [],
    counts: {
      projects: count,
      ...emptyProjectCounts(),
    },
  };
}

function createHarnessOptionSnapshot(count: number): WosmSnapshot {
  const snapshot = createDashboardSnapshot();
  const harnesses = Array.from({ length: count }, (_, index) => {
    const optionNumber = String(index + 1).padStart(2, "0");
    return {
      id: `agent-${optionNumber}`,
      label: `Agent ${optionNumber}`,
    };
  });
  const defaultHarness = harnesses[0]?.id ?? "agent-01";
  return {
    ...snapshot,
    harnesses,
    projects: snapshot.projects.map((project) => ({
      ...project,
      defaults: {
        ...project.defaults,
        harness: defaultHarness,
      },
    })),
  };
}

function emptyProjectCounts(): ProjectView["counts"] {
  return {
    worktrees: 0,
    agents: 0,
    working: 0,
    idle: 0,
    attention: 0,
    unknown: 0,
  };
}

function backgroundRows(): string[] {
  return [
    "background-0",
    "background-1",
    "background-2",
    "background-3",
    "background-4",
    "background-5",
    "background-6",
    "background-7",
    "background-8",
    "background-9",
  ];
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
