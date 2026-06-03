import type { ProjectView, ProviderHealth, WosmSnapshot } from "@wosm/contracts";
import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../../test/fixtures/snapshots.js";
import { createNewSessionFlow, transitionNewSessionFlow } from "../../flows/newSession.js";
import { newSessionBottomSheetLayout } from "./layout.js";
import { NewSessionBottomSheet } from "./NewSessionBottomSheet.js";

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

    expect(layout.top).toBe(9);
    expect(lines).toHaveLength(18);
    expect(lines.slice(0, layout.top).join("").trim()).toBe("");
    expect(lines[layout.top]).toContain("╭");
    expect(frame).toContain("Create Session");
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

    expect(projectFrame).toContain("1 web");
    expect(projectFrame).toContain("2 api");
    expect(projectFrame).toContain("Choose Project");
    expect(projectFrame).not.toContain("›");
    expect(projectFrame).not.toContain("Enter:select");
    expect(projectFrame).toContain("1-9/a-z:select   Esc:back");
    expect(agentFrame).toContain("1 codex");
    expect(agentFrame).toContain("unknown");
    expect(agentFrame).toContain("Choose Agent");
    expect(agentFrame).not.toContain("default");
    expect(agentFrame).toContain("2 opencode");
    expect(agentFrame).not.toContain("›");
    expect(agentFrame).toContain("1-9/a-z:select   Esc:back");
  });

  it("renders only configured harnesses in the agent picker, including Codex, Cursor, Pi, and OpenCode", () => {
    const configured = createConfiguredHarnessSnapshot(["codex", "cursor", "pi", "opencode"]);
    const configuredFrame = renderAgentPickerFrame(configured);

    expect(configuredFrame).toContain("1 codex");
    expect(configuredFrame).toContain("2 cursor");
    expect(configuredFrame).toContain("3 pi");
    expect(configuredFrame).toContain("4 opencode");

    const codexOnly = createConfiguredHarnessSnapshot(["codex"], {
      healthOnly: ["cursor", "pi", "opencode"],
    });
    const codexOnlyFrame = renderAgentPickerFrame(codexOnly);

    expect(codexOnlyFrame).toContain("1 codex");
    expect(codexOnlyFrame).not.toContain("cursor");
    expect(codexOnlyFrame).not.toContain("pi");
    expect(codexOnlyFrame).not.toContain("opencode");
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
    expect(frame).toContain("1-9/a-z:select   Esc:back");
  });

  it("renders letter keys for long project pickers", () => {
    const snapshot = createProjectOptionSnapshot(10);
    const state = createProjectPickerState(snapshot);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).toContain("1 Project 01");
    expect(frame).toContain("9 Project 09");
    expect(frame).toContain("a Project 10");
    expect(frame).not.toContain("›");
    expect(frame).toContain("1-9/a-z:select   Esc:back");
  });

  it("renders letter keys for long agent pickers", () => {
    const snapshot = createHarnessOptionSnapshot(10);
    const state = createAgentPickerState(snapshot);

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" width={80} height={20}>
          <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).toContain("1 Agent 01");
    expect(frame).toContain("9 Agent 09");
    expect(frame).toContain("a Agent 10");
    expect(frame).not.toContain("›");
    expect(frame).toContain("1-9/a-z:select   Esc:back");
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

    expect(frame).toContain("Set Session Name");
    expect(frame).toContain("Project   web");
    expect(frame).toContain("Name      |web-k7p3x9");
    expect(frame).not.toMatch(/Project\s+web\n\s*\n\s*Name/);
    expect(frame).toContain("Enter:save   Esc:back");
    expect(frame).not.toContain("Agent     codex");
    expect(frame).not.toContain("Enter:create");
  });

  it("paints edit-name rows over stale dashboard text", () => {
    const snapshot = createDashboardSnapshot();
    const review = createNewSessionFlow(snapshot, "k7p3x9");
    if (review === undefined) throw new Error("expected a flow");
    const editName = transitionNewSessionFlow(review, snapshot, { type: "editName" });
    if (editName?.mode !== "editName") throw new Error("expected edit-name state");

    const columns = 80;
    const rows = 12;
    const layout = newSessionBottomSheetLayout({
      columns,
      rows,
      state: editName,
      optionCount: 0,
    });
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          {noisyBackgroundRows(rows, columns).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          <NewSessionBottomSheet
            columns={columns}
            rows={rows}
            snapshot={snapshot}
            state={editName}
          />
        </Box>,
        { columns },
      ),
    );
    const sheetLines = frame.split("\n").slice(layout.top, layout.top + layout.height);

    expect(sheetLines.join("\n")).toContain("Set Session Name");
    expect(sheetLines.join("\n")).toContain("Project   web");
    expect(sheetLines.join("\n")).toContain("Name      |web-k7p3x9");
    expect(sheetLines.join("\n")).not.toContain("stale-error");
  });

  it("renders the edit-name cursor after typed draft text", () => {
    const snapshot = createDashboardSnapshot();
    const review = createNewSessionFlow(snapshot, "k7p3x9");
    if (review === undefined) throw new Error("expected a flow");
    const editName = transitionNewSessionFlow(review, snapshot, { type: "editName" });
    if (editName?.mode !== "editName") throw new Error("expected edit-name state");
    const typed = "feature/foo".split("").reduce((state, input) => {
      const next = transitionNewSessionFlow(state, snapshot, {
        type: "editNameInput",
        action: { type: "insert", input },
      });
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
    expect(frame).toContain("Enter:save   Esc:back");
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

    expect(frame).toContain("Enter:create N:name P:project A:agent Esc:cancel");
    const shortcutLine = frame
      .split("\n")
      .find((line) => line.includes("Enter:create N:name P:project"));
    expect(shortcutLine).toContain("│ Enter:create");
    expect(shortcutLine).not.toContain("─Enter:create");
    expect(shortcutLine).not.toContain("Esc:cancel──");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function createProjectPickerState(snapshot: WosmSnapshot) {
  const review = createNewSessionFlow(snapshot, "aaaaaa");
  if (review === undefined) throw new Error("expected a flow");
  const state = transitionNewSessionFlow(review, snapshot, { type: "pickProject" });
  if (state?.mode !== "pickProject") throw new Error("expected project picker");
  return state;
}

function createAgentPickerState(snapshot: WosmSnapshot) {
  const review = createNewSessionFlow(snapshot, "aaaaaa");
  if (review === undefined) throw new Error("expected a flow");
  const state = transitionNewSessionFlow(review, snapshot, { type: "pickAgent" });
  if (state?.mode !== "pickAgent") throw new Error("expected agent picker");
  return state;
}

function renderAgentPickerFrame(snapshot: WosmSnapshot): string {
  const state = createAgentPickerState(snapshot);
  return stripAnsi(
    renderToString(
      <Box position="relative" width={80} height={20}>
        <NewSessionBottomSheet columns={80} rows={20} snapshot={snapshot} state={state} />
      </Box>,
      { columns: 80 },
    ),
  );
}

function createConfiguredHarnessSnapshot(
  harnessIds: string[],
  options: { healthOnly?: string[] } = {},
): WosmSnapshot {
  const snapshot = createDashboardSnapshot();
  const healthEntries = [...harnessIds, ...(options.healthOnly ?? [])].map(
    (id): [string, ProviderHealth] => [
      id,
      {
        providerId: id,
        providerType: "harness",
        status: "healthy",
        lastCheckedAt: snapshot.generatedAt,
      },
    ],
  );
  return {
    ...snapshot,
    harnesses: harnessIds.map((id) => ({ id, label: id })),
    providerHealth: {
      ...snapshot.providerHealth,
      ...Object.fromEntries(healthEntries),
    },
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

function noisyBackgroundRows(rows: number, columns: number): string[] {
  return Array.from({ length: rows }, (_, index) =>
    `stale-error-${index} `.repeat(columns).slice(0, columns),
  );
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
