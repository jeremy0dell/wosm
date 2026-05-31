import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import {
  createDashboardSnapshot,
  createZeroWorktreeSnapshot,
} from "../../../test/fixtures/snapshots.js";
import { ProjectGroup } from "./ProjectGroup.js";

describe("ProjectGroup", () => {
  it("renders the expanded arrow and dash header format", () => {
    const snapshot = createDashboardSnapshot();
    const project = required(snapshot.projects.find((candidate) => candidate.id === "web"));
    const rows = snapshot.rows.filter((candidate) => candidate.projectId === "web");

    const frame = renderToString(
      <ProjectGroup project={project} rows={rows} collapsed={false} choices={[]} />,
    );

    expect(frame).toContain("▼ web - 7 worktrees | codex");
  });

  it("renders zero-worktree projects", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const project = required(snapshot.projects.find((candidate) => candidate.id === "web"));

    const frame = renderToString(
      <ProjectGroup project={project} rows={[]} collapsed={false} choices={[]} />,
    );

    expect(frame).toContain("▼ web - 0 worktrees | codex");
    expect(frame).toContain("0 worktrees");
  });

  it("renders worktree rows with their assigned slots", () => {
    const snapshot = createDashboardSnapshot();
    const project = required(snapshot.projects.find((candidate) => candidate.id === "web"));
    const rows = snapshot.rows.filter((candidate) => candidate.projectId === "web");
    const workingRow = required(rows.find((candidate) => candidate.id === "wt_web_working"));

    const frame = renderToString(
      <ProjectGroup
        project={project}
        rows={rows}
        collapsed={false}
        choices={[{ key: "3", value: workingRow }]}
      />,
    );

    expect(frame).toContain(" [3] ◜ cache-refactor");
  });

  it("renders the collapsed arrow and hides group body rows", () => {
    const snapshot = createDashboardSnapshot();
    const project = required(snapshot.projects.find((candidate) => candidate.id === "web"));
    const rows = snapshot.rows.filter((candidate) => candidate.projectId === "web");

    const frame = renderToString(
      <ProjectGroup project={project} rows={rows} collapsed={true} choices={[]} />,
    );

    expect(frame).toContain("▶ web - 7 worktrees | codex");
    expect(frame).not.toContain("cache-refactor");
    expect(frame).not.toContain("0 worktrees");
  });

  it("hides zero-worktree body text when collapsed", () => {
    const snapshot = createZeroWorktreeSnapshot();
    const project = required(snapshot.projects.find((candidate) => candidate.id === "web"));

    const frame = renderToString(
      <ProjectGroup project={project} rows={[]} collapsed={true} choices={[]} />,
    );

    expect(frame).toContain("▶ web - 0 worktrees | codex");
    expect(frame).not.toContain("\n0 worktrees");
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected fixture value to exist.");
  }
  return value;
}
