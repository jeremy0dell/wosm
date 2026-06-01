import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { fixtureNow, row } from "../../../test/fixtures/snapshots.js";
import { metadataSegments, WorktreeRow } from "./WorktreeRow.js";

type AgentState = NonNullable<WorktreeRowModel["agent"]>["state"];
type FixtureState = AgentState | "none";
type ChecksSummary = NonNullable<WorktreeRowModel["worktree"]["checks"]>;

describe("WorktreeRow", () => {
  it("renders every row marker with one leading indent", () => {
    const cases: Array<{ state: FixtureState; branch: string; marker: string }> = [
      { state: "none", branch: "feature-auth", marker: "-" },
      { state: "starting", branch: "booting-agent", marker: "+" },
      { state: "idle", branch: "fix-nav-mobile", marker: "○" },
      { state: "working", branch: "cache-refactor", marker: "◜" },
      { state: "needs_attention", branch: "checkout-copy", marker: "!" },
      { state: "stuck", branch: "slow-tests", marker: "!" },
      { state: "unknown", branch: "ghost-signal", marker: "?" },
      { state: "exited", branch: "done-run", marker: "x" },
    ];

    for (const testCase of cases) {
      const candidate = makeRow(testCase.state, testCase.branch);
      const frame = renderToString(<WorktreeRow row={candidate} slot="1" />);
      expect(frame).toContain(` [1] ${testCase.marker} ${testCase.branch}`);
    }

    const noSlot = renderToString(
      <WorktreeRow row={makeRow("none", "no-slot")} slot={undefined} />,
    );
    expect(noSlot).toContain(" [ ] - no-slot");
  });

  it("replaces the working marker with the first circle throbber frame", () => {
    const frame = renderToString(
      <WorktreeRow row={makeRow("working", "cache-refactor")} slot="1" />,
    );

    expect(frame).toContain(" [1] ◜ cache-refactor");
    expect(frame).not.toContain(" [1] * cache-refactor");
  });

  it("keeps harness visible while hiding textual status and terminal provider", () => {
    const candidate = makeRow("working", "cache-refactor");

    const frame = renderToString(<WorktreeRow row={candidate} slot="4" />);

    expect(frame).toContain("codex");
    expect(frame).not.toContain("working");
    expect(frame).not.toContain("tmux");
  });

  it("renders a session title when the dashboard resolves one", () => {
    const candidate = makeRow("idle", "fix-nav-mobile");

    const frame = renderToString(
      <WorktreeRow row={candidate} slot="5" title="Readable feature task" />,
    );

    expect(frame).toContain(" [5] ○ Readable feature task");
    expect(frame).not.toContain("fix-nav-mobile");
  });

  it("shows warning reasons without rendering ordinary display reasons", () => {
    const ordinary = makeRow("working", "ordinary-reason");
    const warning: WorktreeRowModel = {
      ...makeRow("unknown", "warning-reason"),
      display: {
        statusLabel: "unknown",
        sortPriority: 50,
        alert: false,
        warning: true,
        reason: "Terminal target is stale.",
      },
    };

    expect(renderToString(<WorktreeRow row={ordinary} slot="1" />)).not.toContain(
      "Harness reported active generation.",
    );
    const warningFrame = renderToString(<WorktreeRow row={warning} slot="2" />);
    expect(warningFrame).toContain("Terminal target is stale.");
    expect(warningFrame).not.toContain("unknown Terminal target is stale.");
  });

  it("renders PR links and preserves stale metadata flags", () => {
    const candidate = withWorktree(makeRow("working", "linked-pr"), {
      pr: {
        number: 123,
        url: "https://github.com/example/web/pull/123",
        stale: true,
      },
      checks: checksSummary("pass", { stale: true }),
    });

    const frame = renderToString(<WorktreeRow row={candidate} slot="9" />);
    const segments = metadataSegments(candidate);

    expect(frame).toContain(
      "\u001B]8;id=wosm-fNrWuVdbZiLi;https://github.com/example/web/pull/123\u0007#123",
    );
    expect(segments).toEqual([
      {
        text: "#123",
        stale: true,
        color: "blue",
        underline: true,
        url: "https://github.com/example/web/pull/123",
      },
      { text: "✓", stale: true, color: "green" },
    ]);
  });

  it("renders diff-only rows without requiring PR metadata", () => {
    const candidate = withWorktree(makeRow("working", "diff-only"), {
      changeSummary: changeSummary({ additions: 24, deletions: 6 }),
    });

    const frame = renderToString(<WorktreeRow row={candidate} slot="5" />);

    expect(frame).toContain("+24");
    expect(frame).toContain("-6");
    expect(frame).not.toContain("+24/-6");
    expect(frame).not.toContain("#");
    expect(frame).not.toContain("✓");
  });

  it("hides zero-change diff metadata", () => {
    const candidate = withWorktree(makeRow("working", "no-diff"), {
      changeSummary: changeSummary({ additions: 0, deletions: 0 }),
    });

    const frame = renderToString(<WorktreeRow row={candidate} slot="5" />);

    expect(metadataSegments(candidate)).toEqual([]);
    expect(frame).not.toContain("+0/-0");
  });

  it("right-aligns diff, PR, and CI metadata apart from the row identity", () => {
    const candidate = withWorktree(makeRow("working", "right-align"), {
      changeSummary: changeSummary({ additions: 24, deletions: 6 }),
      pr: {
        number: 42,
      },
      checks: checksSummary("pass"),
    });

    const frame = renderToString(
      <Box width={80}>
        <WorktreeRow row={candidate} slot="5" />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain(" [5] ◜ right-align  codex");
    expect(frame).toMatch(/\s{2,}\+24 -6 #42 ✓$/);
  });

  it("renders PR metadata without checks", () => {
    const candidate = withWorktree(makeRow("working", "pr-only"), {
      pr: {
        number: 42,
      },
    });

    const frame = renderToString(<WorktreeRow row={candidate} slot="6" />);

    expect(frame).toContain("#42");
    expect(frame).not.toContain("✓");
    expect(frame).not.toContain("ci:");
  });

  it("suppresses checks when no PR exists", () => {
    const candidate = withWorktree(makeRow("working", "checks-without-pr"), {
      checks: checksSummary("pass"),
    });

    const frame = renderToString(<WorktreeRow row={candidate} slot="7" />);

    expect(metadataSegments(candidate)).toEqual([]);
    expect(frame).not.toContain("✓");
    expect(frame).not.toContain("ci:");
  });

  it("maps normalized check states to aggregate glyphs only when a PR exists", () => {
    const cases: Array<{ checks: ChecksSummary; glyph: string; color: string }> = [
      { checks: checksSummary("pass"), glyph: "✓", color: "green" },
      { checks: checksSummary("fail", { failed: 2 }), glyph: "x2", color: "red" },
      { checks: checksSummary("fail"), glyph: "x", color: "red" },
      { checks: checksSummary("cancelled", { cancelled: 3 }), glyph: "x3", color: "red" },
      { checks: checksSummary("cancelled"), glyph: "x", color: "red" },
      { checks: checksSummary("running"), glyph: "…", color: "yellow" },
      { checks: checksSummary("none"), glyph: "-", color: "gray" },
      { checks: checksSummary("unknown"), glyph: "-", color: "gray" },
      { checks: checksSummary("skipped"), glyph: "-", color: "gray" },
    ];

    for (const testCase of cases) {
      const candidate = withWorktree(makeRow("working", `checks-${testCase.checks.state}`), {
        pr: {
          number: 77,
        },
        checks: testCase.checks,
      });

      expect(metadataSegments(candidate).at(-1)).toEqual({
        text: testCase.glyph,
        stale: false,
        color: testCase.color,
      });
    }
  });
});

function makeRow(state: FixtureState, branch: string): WorktreeRowModel {
  return row({
    id: `wt_web_${branch.replaceAll("-", "_")}`,
    projectId: "web",
    branch,
    state,
  });
}

function withWorktree(
  candidate: WorktreeRowModel,
  worktree: Partial<WorktreeRowModel["worktree"]>,
): WorktreeRowModel {
  return {
    ...candidate,
    worktree: {
      ...candidate.worktree,
      ...worktree,
    },
  };
}

function checksSummary(
  state: ChecksSummary["state"],
  counts: {
    failed?: number;
    cancelled?: number;
    stale?: boolean;
  } = {},
): ChecksSummary {
  const summary: ChecksSummary = {
    state,
    source: "github",
    checkedAt: fixtureNow,
  };
  if (counts.failed !== undefined) summary.failed = counts.failed;
  if (counts.cancelled !== undefined) summary.cancelled = counts.cancelled;
  if (counts.stale !== undefined) summary.stale = counts.stale;
  return summary;
}

function changeSummary(input: { additions: number; deletions: number }) {
  return {
    kind: "branch_diff" as const,
    additions: input.additions,
    deletions: input.deletions,
    source: "local_git",
    checkedAt: fixtureNow,
  };
}
