import {
  clampDashboardScrollOffset,
  DASHBOARD_FIXED_ROW_HEIGHTS,
  dashboardBodyRows,
  dashboardFixedRows,
} from "@wosm/dashboard-core";
import { describe, expect, it } from "vitest";

describe("dashboard layout geometry", () => {
  it("derives fixed rows from named dashboard regions", () => {
    expect(dashboardFixedRows()).toBe(
      Object.values(DASHBOARD_FIXED_ROW_HEIGHTS).reduce((total, rows) => total + rows, 0),
    );
    expect(Object.keys(DASHBOARD_FIXED_ROW_HEIGHTS)).toEqual([
      "header",
      "topDivider",
      "topScrollIndicator",
      "bottomScrollIndicator",
      "bottomDivider",
      "footer",
    ]);
  });

  it("keeps at least one body row after fixed dashboard regions", () => {
    expect(dashboardBodyRows(24)).toBe(18);
    expect(dashboardBodyRows(6)).toBe(1);
    expect(dashboardBodyRows(3)).toBe(1);
  });

  it("clamps scroll offsets to the body sliceable range", () => {
    expect(clampDashboardScrollOffset({ bodyRows: 5, itemCount: 20, scrollOffset: -3 })).toBe(0);
    expect(clampDashboardScrollOffset({ bodyRows: 5, itemCount: 20, scrollOffset: 7 })).toBe(7);
    expect(clampDashboardScrollOffset({ bodyRows: 5, itemCount: 20, scrollOffset: 30 })).toBe(15);
    expect(clampDashboardScrollOffset({ bodyRows: 5, itemCount: 3, scrollOffset: 30 })).toBe(0);
  });
});
