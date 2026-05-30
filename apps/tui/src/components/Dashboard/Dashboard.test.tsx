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
          uiState={{ searchQuery: "", collapsedProjectIds: new Set(["web"]) }}
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
});
