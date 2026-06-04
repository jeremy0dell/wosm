import type { WorktreeRow as WorktreeRowModel } from "@wosm/contracts";
import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { fixtureNow, row } from "../../../test/fixtures/snapshots.js";
import {
  cellWidth,
  layoutWorktreeRow,
  layoutWorktreeRowGrid,
  type RowGridRowInput,
  type RowSegment,
  segmentsWidth,
  textSegment,
  truncateCells,
  type WorktreeRowLayout,
  type WorktreeRowLayoutInput,
} from "./layout.js";
import { metadataSegments, WorktreeRow, worktreeStyleRowGridInput } from "./WorktreeRow.js";

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

  it("keeps harness and activity visible while hiding terminal provider", () => {
    const candidate = makeRow("working", "cache-refactor");

    const frame = renderToString(<WorktreeRow row={candidate} slot="4" />);

    expect(frame).toContain("codex");
    expect(frame).toContain("working");
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
    expect(warningFrame).toContain("Terminal target");
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
        <WorktreeRow columns={80} row={candidate} slot="5" />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain(" [5] ◜ right-align");
    expect(frame).toContain("codex");
    expect(frame).toContain("working");
    expect(visibleCellWidth(frame)).toBe(80);
    expect(frame).toMatch(/\s{2,}\+24 -6 #42 ✓$/);
  });

  it("computes shared title, agent, and activity columns for visible rows", () => {
    const rows = representativeGridRows();

    for (const columns of [100, 80]) {
      const layouts = layoutWorktreeRowGrid({ columns, rows });
      const rendered = layouts.map(layoutText);

      expect(uniqueStarts(rendered, ["example-feature", "hook-event-naming", "row-ui"])).toEqual([
        7,
      ]);
      expect(uniqueStarts(rendered, ["codex", "codex", "codex"])).toHaveLength(1);
      expect(uniqueStarts(rendered, ["idle", "idle", "working"])).toHaveLength(1);
    }
  });

  it("keeps pure layout output within every terminal width", () => {
    const cases: WorktreeRowLayoutInput[] = [
      {
        columns: 80,
        slot: "1",
        marker: { kind: "throbber", variant: "circle" },
        title: "cache-refactor",
        harness: "codex",
        metadata: fullMetadata(),
      },
      {
        columns: 80,
        slot: "2",
        marker: { kind: "text", text: "!" },
        title: "stale-terminal-target",
        harness: "codex",
        statusText: "Terminal target is stale.",
        color: "red",
      },
      {
        columns: 80,
        slot: undefined,
        marker: { kind: "throbber", variant: "braille" },
        title: "feature/pending-session",
        statusText: "starting session...",
      },
      {
        columns: 80,
        slot: "a",
        marker: { kind: "text", text: "○" },
        title: "日本語-worktree-✓-running…",
        harness: "opencode",
        metadata: {
          diff: [],
          pr: [
            textSegment("#123", {
              color: "blue",
              underline: true,
              url: "https://example.test/pr/123",
            }),
          ],
        },
      },
    ];

    for (const testCase of cases) {
      for (let columns = 1; columns <= 200; columns += 1) {
        const layout = layoutWorktreeRow({ ...testCase, columns });
        const rendered = layoutText(layout);

        expect(rendered).not.toContain("\n");
        expect(layoutCellWidth(layout)).toBeLessThanOrEqual(columns);
        expect(visibleCellWidth(rendered)).toBeLessThanOrEqual(columns);
      }
    }
  });

  it("degrades right metadata globally when required columns can no longer fit", () => {
    const base: WorktreeRowLayoutInput = {
      columns: 80,
      slot: "5",
      marker: { kind: "throbber", variant: "circle" },
      title: "right-align",
      harness: "codex",
      metadata: fullMetadata(),
    };

    const full = layoutWorktreeRow({ ...base, columns: 29 });
    const compact = layoutWorktreeRow({ ...base, columns: 22 });
    const hidden = layoutWorktreeRow({ ...base, columns: 12 });

    expect(layoutText(full)).toMatch(/\+24 -6 #42 ✓$/);
    expect(full.hidden.metadata).toEqual([]);
    expect(full.hidden.cells).toContain("agent");
    expect(layoutText(compact)).toMatch(/#42 ✓$/);
    expect(layoutText(compact)).not.toContain("+24");
    expect(compact.hidden.cells).toContain("agent");
    expect(compact.hidden.metadata).toEqual(["diff"]);
    expect(layoutText(hidden)).not.toContain("+24");
    expect(layoutText(hidden)).not.toContain("#42");
    expect(hidden.hidden.metadata).toEqual(["diff", "pr"]);
  });

  it("drops harness before warning or local action text", () => {
    const layout = layoutWorktreeRow({
      columns: 35,
      slot: "2",
      marker: { kind: "text", text: "!" },
      title: "feature-authentication",
      harness: "codex",
      statusText: "Terminal target is stale.",
      color: "red",
    });
    const rendered = layoutText(layout);

    expect(layout.hidden.cells).toContain("agent");
    expect(layout.hidden.cells).not.toContain("activity");
    expect(rendered).not.toContain("codex");
    expect(rendered).toContain("…");
    expect(visibleCellWidth(rendered)).toBeLessThanOrEqual(35);
  });

  it("truncates titles by terminal cells without splitting wide glyphs", () => {
    const truncated = truncateCells("日本語-worktree", 5);
    const layout = layoutWorktreeRow({
      columns: 13,
      slot: "8",
      marker: { kind: "text", text: "○" },
      title: "日本語-worktree",
      harness: "codex",
    });

    expect(truncated).toBe("日本…");
    expect(cellWidth(truncated)).toBe(5);
    expect(layoutText(layout)).toContain("…");
    expect(layoutCellWidth(layout)).toBeLessThanOrEqual(13);
  });

  it("measures check glyphs, ellipsis, wide glyphs, and throbber frames by terminal cells", () => {
    for (const frame of ["◜", "◠", "◝", "◞", "◡", "◟"]) {
      expect(cellWidth(frame)).toBe(1);
    }
    for (const frame of ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]) {
      expect(cellWidth(frame)).toBe(1);
    }
    expect(cellWidth("✓")).toBe(1);
    expect(cellWidth("…")).toBe(1);
    expect(cellWidth("界")).toBe(2);
    expect(segmentsWidth([{ kind: "throbber", variant: "circle" }])).toBe(1);
    expect(segmentsWidth([{ kind: "throbber", variant: "braille" }])).toBe(1);
  });

  it("measures linked PR metadata by visible text only", () => {
    const layout = layoutWorktreeRow({
      columns: 24,
      slot: "9",
      marker: { kind: "text", text: "○" },
      title: "link",
      metadata: {
        diff: [],
        pr: [
          textSegment("#123", {
            color: "blue",
            underline: true,
            url: "https://github.com/example/web/pull/123",
          }),
          textSegment("✓", { color: "green" }),
        ],
      },
    });

    expect(layoutText(layout)).toMatch(/#123 ✓$/);
    expect(segmentsWidth(layout.segments)).toBe(24);
  });

  it("renders configured component widths without overflowing", () => {
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
    const cases: Array<{ row: WorktreeRowModel; slot: string | undefined; title?: string }> = [
      { row: makeRow("working", "cache-refactor"), slot: "1" },
      { row: warning, slot: "2" },
      { row: makeRow("none", "feature-auth"), slot: "4" },
      {
        row: withWorktree(makeRow("working", "right-align"), {
          changeSummary: changeSummary({ additions: 24, deletions: 6 }),
          pr: { number: 42 },
          checks: checksSummary("pass"),
        }),
        slot: "5",
      },
      { row: makeRow("idle", "agent-created-branch"), slot: "6", title: "Readable feature task" },
    ];

    for (const columns of [80, 48, 32, 16]) {
      for (const testCase of cases) {
        const frame = renderToString(
          <WorktreeRow
            columns={columns}
            row={testCase.row}
            slot={testCase.slot}
            title={testCase.title}
          />,
          { columns },
        );

        expect(frame).not.toContain("\n");
        expect(visibleCellWidth(frame)).toBeLessThanOrEqual(columns);
      }
    }
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

function fullMetadata() {
  return {
    diff: [textSegment("+24", { color: "green" }), textSegment("-6", { color: "red" })],
    pr: [
      textSegment("#42", { color: "blue", underline: true }),
      textSegment("✓", { color: "green" }),
    ],
  };
}

function representativeGridRows(): RowGridRowInput[] {
  return [
    worktreeStyleRowGridInput({
      id: "row-1",
      slot: "1",
      marker: { kind: "text", text: "○" },
      title: "example-feature",
      agent: "codex",
      activity: "idle",
    }),
    worktreeStyleRowGridInput({
      id: "row-2",
      slot: "2",
      marker: { kind: "text", text: "○" },
      title: "hook-event-naming",
      agent: "codex",
      activity: "idle",
      metadataGroups: fullMetadata(),
    }),
    worktreeStyleRowGridInput({
      id: "row-3",
      slot: "3",
      marker: { kind: "throbber", variant: "circle" },
      title: "row-ui",
      agent: "codex",
      activity: "working",
    }),
  ];
}

function layoutText(layout: WorktreeRowLayout): string {
  return segmentsText(layout.segments);
}

function segmentsText(segments: readonly RowSegment[]): string {
  return segments.map(segmentText).join("");
}

function segmentText(segment: RowSegment): string {
  if (segment.kind === "text") {
    return segment.text;
  }
  return segment.variant === "circle" ? "◜" : "⠋";
}

function layoutCellWidth(layout: WorktreeRowLayout): number {
  return segmentsWidth(layout.segments);
}

function uniqueStarts(rendered: readonly string[], needles: readonly string[]): number[] {
  return [
    ...new Set(
      needles.map((needle, index) => {
        const start = rendered[index]?.indexOf(needle) ?? -1;
        if (start < 0) {
          throw new Error(`Expected row ${index} to contain ${needle}.`);
        }
        return start;
      }),
    ),
  ];
}

function visibleCellWidth(text: string): number {
  return cellWidth(stripOsc8(text));
}

function stripOsc8(text: string): string {
  const pattern = ["\\u001B]8;[^\\u0007]*\\u0007"].join("");
  return text.replace(new RegExp(pattern, "g"), "");
}
