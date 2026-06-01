import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../../test/fixtures/snapshots.js";
import { Dashboard } from "./Dashboard.js";

describe("Dashboard", () => {
  it("respects collapsed project ids when rendering groups and slots", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={24} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(["web"]),
            scrollOffset: 0,
            terminalRows: 24,
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [] },
          }}
        />
      </Box>,
      { columns: 100 },
    );

    expect(frame).toContain("▶ web - 7 worktrees | codex");
    expect(frame).not.toContain("cache-refactor");
    expect(frame).not.toContain("slow-tests");
    expect(frame).toContain("▼ api - 1 worktrees | opencode");
    expect(frame).toContain(" [1] ◜ queue-worker");
  });

  it("clips body rows to the viewport and renders scroll indicators", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={10} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(),
            scrollOffset: 2,
            terminalRows: 10,
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [] },
          }}
        />
      </Box>,
      { columns: 100 },
    );
    const lines = frame.split("\n");
    const body = lines.slice(3, -3).join("\n");

    expect(lines).toHaveLength(10);
    expect(lines[2]).toContain("↑ 2 hidden");
    expect(body).toContain(" [1] ◜ cache-refactor");
    expect(body).toContain(" [4] - feature-auth");
    expect(body).not.toContain("fix-nav-mobile");
    expect(body).not.toContain("queue-worker");
    expect(lines.at(-3)).toContain("↓ 6 hidden");
    expect(lines.at(-2)).toMatch(/^─+$/);
    expect(lines.at(-1)).toContain("N:new");
  });
});
