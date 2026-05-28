import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { OptimisticSessionRow } from "../OptimisticSessionRow.js";

describe("OptimisticSessionRow", () => {
  it("renders a non-slot creating row", () => {
    const frame = renderToString(
      <OptimisticSessionRow
        row={{
          id: "pending_1",
          projectId: "web",
          branch: "fix-popup-close",
          harnessProvider: "codex",
        }}
      />,
      { columns: 80 },
    );

    expect(frame).toContain(" [ ] ⠋ fix-popup-close creating session...");
    expect(frame).not.toContain("[1]");
  });
});
