import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../test/fixtures/snapshots.js";
import { selectTuiFeatureFlags } from "./featureFlags.js";

describe("TUI feature flag selectors", () => {
  it("treats missing feature flags as an empty evaluated client set", () => {
    const snapshot = createDashboardSnapshot();

    expect(selectTuiFeatureFlags(snapshot)).toEqual({});
  });

  it("returns the evaluated client flag map from the observer snapshot", () => {
    const snapshot = {
      ...createDashboardSnapshot(),
      featureFlags: {
        revision: "test",
        flags: {},
      },
    };

    expect(selectTuiFeatureFlags(snapshot)).toEqual({});
  });
});
