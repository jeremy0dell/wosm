import { renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { TuiFrame } from "./TuiFrame.js";

describe("TuiFrame", () => {
  it("preserves children inside the requested frame", () => {
    const frame = renderToString(
      <TuiFrame columns={20} rows={3}>
        <Text>dashboard</Text>
      </TuiFrame>,
      { columns: 20 },
    );

    expect(frame).toContain("dashboard");
    expect(frame.split("\n")).toHaveLength(3);
  });

  it("clamps invalid dimensions to a visible one-cell frame", () => {
    const frame = renderToString(
      <TuiFrame columns={0} rows={0}>
        <Text>x</Text>
      </TuiFrame>,
      { columns: 1 },
    );

    expect(frame).toBe("x");
  });
});
