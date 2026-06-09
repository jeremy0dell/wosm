import { describe, expect, it } from "vitest";
import type {
  ConfigWritePlan,
  SetupFacts,
  SetupHarnessFact,
  SupportedHarnessId,
} from "../../src/commands/setup/model.js";
import { buildSetupPlan } from "../../src/commands/setup/planner.js";

describe("setup planner", () => {
  it("reports all core checks ready and no selected actions", () => {
    const plan = buildSetupPlan(facts());

    expect(plan.summary).toMatchObject({
      requiredOk: true,
      requiredMissing: 0,
      selectedActions: 0,
      selectedHarness: "codex",
    });
    expect(plan.checks.map((check) => [check.id, check.status])).toEqual([
      ["worktrunk", "ok"],
      ["tmux", "ok"],
      ["git-project", "ok"],
      ["harness", "ok"],
      ["config", "ok"],
      ["worktrunk-shell-integration", "warning"],
      ["doctor", "warning"],
    ]);
  });

  it("plans Homebrew installs for missing required tools", () => {
    const plan = buildSetupPlan(
      facts({
        worktrunk: {
          status: "missing",
          command: "wt",
          message: "Worktrunk missing.",
        },
        tmux: {
          status: "missing",
          command: "tmux",
          message: "tmux missing.",
        },
      }),
    );

    expect(plan.summary.requiredMissing).toBe(2);
    expect(plan.actions.filter((action) => action.selected)).toMatchObject([
      {
        id: "install-worktrunk",
        kind: "brew-install",
        command: ["brew", "install", "worktrunk"],
      },
      {
        id: "install-tmux",
        kind: "brew-install",
        command: ["brew", "install", "tmux"],
      },
    ]);
  });

  it("blocks config writes when no harness is available", () => {
    const plan = buildSetupPlan(
      facts({
        harnesses: harnesses([]),
        config: {
          status: "missing",
          path: "/tmp/config.toml",
          message: "Config missing.",
        },
      }),
      {
        configWrite: createConfigWrite(),
      },
    );

    expect(plan.checks.find((check) => check.id === "harness")).toMatchObject({
      status: "missing",
    });
    expect(plan.actions.some((action) => action.kind === "write-config")).toBe(false);
  });

  it("selects the first available harness in stable detection order", () => {
    const plan = buildSetupPlan(
      facts({
        harnesses: harnesses(["cursor", "opencode", "pi"]),
      }),
    );

    expect(plan.summary.selectedHarness).toBe("cursor");
  });

  it("respects an explicit selected harness when multiple are available", () => {
    const plan = buildSetupPlan(
      facts({
        selectedHarness: "opencode",
        harnesses: harnesses(["codex", "opencode"]),
      }),
    );

    expect(plan.summary.selectedHarness).toBe("opencode");
    expect(plan.checks.find((check) => check.id === "harness")?.details).toMatchObject({
      selected: "opencode",
    });
  });

  it("plans config creation for a new config", () => {
    const plan = buildSetupPlan(
      facts({
        config: {
          status: "missing",
          path: "/tmp/config.toml",
          message: "Config missing.",
        },
      }),
      {
        configWrite: createConfigWrite(),
      },
    );

    expect(plan.actions.filter((action) => action.selected).map((action) => action.id)).toEqual([
      "mkdir-config-dir",
      "write-config",
    ]);
  });

  it("plans a safe append for an existing config", () => {
    const plan = buildSetupPlan(facts(), {
      configWrite: {
        operation: "append",
        path: "/tmp/config.toml",
        content: "schema_version = 1\n",
        appendedText: "\n[[projects]]\n",
      },
    });

    expect(plan.actions.find((action) => action.id === "append-config")).toMatchObject({
      kind: "write-config",
      selected: true,
      data: {
        operation: "append",
        appendedText: "\n[[projects]]\n",
      },
    });
  });

  it("uses a noop action for invalid existing config", () => {
    const plan = buildSetupPlan(facts(), {
      configWrite: {
        operation: "blocked",
        path: "/tmp/config.toml",
        reason: "Config is invalid.",
      },
    });

    expect(plan.actions.find((action) => action.id === "config-blocked")).toMatchObject({
      kind: "noop",
      selected: false,
    });
  });
});

function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    generatedAt: "2026-06-08T12:00:00.000Z",
    mode: "plan",
    configPath: "/tmp/config.toml",
    worktrunk: {
      status: "ok",
      command: "wt",
      version: "1.0.0",
    },
    tmux: {
      status: "ok",
      command: "tmux",
      version: "3.5a",
    },
    brew: {
      status: "ok",
      command: "brew",
      version: "4.0.0",
    },
    git: {
      status: "ok",
      root: "/tmp/repo",
      defaultBranch: "main",
      repoName: "repo",
    },
    harnesses: harnesses(["codex"]),
    config: {
      status: "valid",
      path: "/tmp/config.toml",
      source: "schema_version = 1\n",
      hasProjectForRoot: true,
      configuredHarnesses: ["codex"],
    },
    ...overrides,
  };
}

function harnesses(available: readonly SupportedHarnessId[]): SetupHarnessFact[] {
  return (["codex", "cursor", "opencode", "pi"] as const).map((id) => ({
    id,
    label: id,
    status: available.includes(id) ? "ok" : "missing",
    command: id === "cursor" ? "agent" : id,
  }));
}

function createConfigWrite(): ConfigWritePlan {
  return {
    operation: "create",
    path: "/tmp/config.toml",
    content: "schema_version = 1\n",
  };
}
