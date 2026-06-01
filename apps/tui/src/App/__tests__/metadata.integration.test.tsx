import type { WorktreeChangeSummary, WosmSnapshot } from "@wosm/contracts";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { createCommandSnapshot, fixtureNow } from "../../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../../test/support/fakeObserverService.js";
import { App } from "../App.js";

describe("TUI app metadata rendering", () => {
  it("suppresses zero local git diff badges from observer snapshots", () => {
    const snapshot = snapshotWithChangeSummary({ additions: 0, deletions: 0 });
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("fix-nav-mobile");
    expect(frame).not.toContain("+0");
    expect(frame).not.toContain("-0");
    instance.unmount();
  });

  it("renders nonzero local git diff badges from observer snapshots", () => {
    const snapshot = snapshotWithChangeSummary({ additions: 24, deletions: 6 });
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<App initialSnapshot={snapshot} service={service} />);
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("+24");
    expect(frame).toContain("-6");
    instance.unmount();
  });
});

function snapshotWithChangeSummary(input: { additions: number; deletions: number }): WosmSnapshot {
  const snapshot = createCommandSnapshot("idle");
  const [firstRow, ...remainingRows] = snapshot.rows;
  if (firstRow === undefined) {
    throw new Error("Expected command snapshot to include a worktree row.");
  }

  const changeSummary: WorktreeChangeSummary = {
    kind: "branch_diff",
    additions: input.additions,
    deletions: input.deletions,
    filesChanged: input.additions > 0 || input.deletions > 0 ? 2 : 0,
    binaryFiles: 0,
    baseRef: "origin/main",
    baseSha: "1111111111111111111111111111111111111111",
    mergeBaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    headRef: firstRow.branch,
    headSha: "2222222222222222222222222222222222222222",
    source: "local_git",
    checkedAt: fixtureNow,
  };

  return {
    ...snapshot,
    rows: [
      {
        ...firstRow,
        worktree: {
          ...firstRow.worktree,
          changeSummary,
        },
      },
      ...remainingRows,
    ],
  };
}
