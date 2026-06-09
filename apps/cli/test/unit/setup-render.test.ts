import { describe, expect, it } from "vitest";
import type { SetupAction, SetupPlan } from "../../src/commands/setup/model.js";
import { renderActionStart, renderSetupPlan } from "../../src/commands/setup/render.js";

describe("setup renderer", () => {
  it("renders a spaced checklist without color by default", () => {
    const output = renderSetupPlan(plan());

    expect(output).toContain("Core\n\n");
    expect(output).toContain("  OK        Worktrunk / wt");
    expect(output).toContain("  MISSING   WOSM project config");
    expect(output).toContain("           path /tmp/wosm/config.toml");
    expect(output).toContain("Actions\n\n");
    expect(output).toContain("  WILL      Write WOSM config");
    expect(output).toContain("           command brew install tmux");
    expect(output).not.toContain("\u001B[");
  });

  it("adds ANSI styling only when requested", () => {
    const output = renderSetupPlan(plan(), { color: true });

    expect(output).toContain("\u001B[1m");
    expect(output).toContain("\u001B[32mOK\u001B[0m");
    expect(output).toContain("\u001B[31mMISSING\u001B[0m");
  });

  it("styles action progress while preserving readable plain text", () => {
    const action: SetupAction = {
      id: "write-config",
      kind: "write-config",
      tier: "required",
      selected: true,
      label: "Write WOSM config",
      message: "Write config.",
      path: "/tmp/wosm/config.toml",
    };

    expect(renderActionStart(action)).toBe("Applying: Write WOSM config (/tmp/wosm/config.toml)");
    expect(renderActionStart(action, { color: true })).toContain("\u001B[1mApplying:\u001B[0m");
  });
});

function plan(): SetupPlan {
  return {
    generatedAt: "2026-06-08T12:00:00.000Z",
    mode: "plan",
    checks: [
      {
        id: "worktrunk",
        tier: "required",
        status: "ok",
        label: "Worktrunk / wt",
        message: "Worktrunk / wt is available.",
        details: { command: "wt", version: "1.2.3" },
      },
      {
        id: "config",
        tier: "required",
        status: "missing",
        label: "WOSM project config",
        message: "Config is missing.",
        details: { path: "/tmp/wosm/config.toml" },
      },
    ],
    actions: [
      {
        id: "install-tmux",
        kind: "brew-install",
        tier: "required",
        selected: true,
        label: "Install tmux",
        message: "Install tmux with Homebrew.",
        command: ["brew", "install", "tmux"],
      },
      {
        id: "write-config",
        kind: "write-config",
        tier: "required",
        selected: true,
        label: "Write WOSM config",
        message: "Create the core WOSM config.",
        path: "/tmp/wosm/config.toml",
      },
    ],
    summary: {
      requiredOk: false,
      requiredMissing: 1,
      warnings: 0,
      selectedActions: 2,
      configPath: "/tmp/wosm/config.toml",
    },
    nextSteps: ["wosm setup check"],
  };
}
