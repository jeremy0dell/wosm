import { selectSetupHarness } from "./harnessSelection.js";
import type {
  ConfigWritePlan,
  SetupAction,
  SetupCheck,
  SetupFacts,
  SetupHarnessFact,
  SetupPlan,
  SupportedHarnessId,
} from "./model.js";
import { SetupPlanSchema } from "./model.js";

export type BuildSetupPlanOptions = {
  configWrite?: ConfigWritePlan;
};

export function buildSetupPlan(facts: SetupFacts, options: BuildSetupPlanOptions = {}): SetupPlan {
  const selectedHarness = selectSetupHarness(facts.harnesses, facts.selectedHarness);
  const checks = setupChecks(facts, selectedHarness?.id);
  const actions = setupActions(facts, selectedHarness, options.configWrite);
  const requiredMissing = checks.filter(
    (check) => check.tier === "required" && check.status === "missing",
  ).length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const summary = {
    requiredOk: requiredMissing === 0,
    requiredMissing,
    warnings,
    selectedActions: actions.filter((action) => action.selected).length,
    configPath: facts.configPath,
    ...(selectedHarness === undefined ? {} : { selectedHarness: selectedHarness.id }),
  };
  const plan = {
    generatedAt: facts.generatedAt,
    mode: facts.mode,
    checks,
    actions,
    summary,
    nextSteps: nextSteps(requiredMissing, facts),
  };
  return SetupPlanSchema.parse(plan);
}

function setupChecks(
  facts: SetupFacts,
  selectedHarness: SupportedHarnessId | undefined,
): SetupCheck[] {
  return [
    dependencyCheck({
      id: "worktrunk",
      label: "Worktrunk / wt",
      missingMessage: facts.worktrunk.message ?? "Worktrunk is required for core worktree setup.",
      dependency: facts.worktrunk,
    }),
    dependencyCheck({
      id: "tmux",
      label: "tmux",
      missingMessage: facts.tmux.message ?? "tmux is required for the reference terminal workflow.",
      dependency: facts.tmux,
    }),
    gitCheck(facts),
    harnessCheck(facts, selectedHarness),
    configCheck(facts),
    {
      id: "worktrunk-shell-integration",
      tier: "recommended",
      status: facts.worktrunk.status === "ok" ? "warning" : "skipped",
      label: "Worktrunk shell integration",
      message:
        facts.worktrunk.status === "ok"
          ? "Recommended after core setup: wt config shell install."
          : "Skipped until Worktrunk is available.",
    },
    {
      id: "doctor",
      tier: "recommended",
      status: "warning",
      label: "wosm doctor",
      message: "Run wosm doctor after setup to validate the observer runtime.",
    },
  ];
}

function dependencyCheck(input: {
  id: string;
  label: string;
  missingMessage: string;
  dependency: SetupFacts["worktrunk"];
}): SetupCheck {
  const details: Record<string, string> = { command: input.dependency.command };
  if (input.dependency.version !== undefined) details.version = input.dependency.version;
  if (input.dependency.resolvedPath !== undefined) {
    details.resolvedPath = input.dependency.resolvedPath;
  }
  return {
    id: input.id,
    tier: "required",
    status: input.dependency.status === "ok" ? "ok" : "missing",
    label: input.label,
    message:
      input.dependency.status === "ok" ? `${input.label} is available.` : input.missingMessage,
    details,
  };
}

function gitCheck(facts: SetupFacts): SetupCheck {
  if (facts.git.status === "ok") {
    return {
      id: "git-project",
      tier: "required",
      status: "ok",
      label: "Git project",
      message: "Current directory is inside a git repository.",
      details: {
        root: facts.git.root,
        defaultBranch: facts.git.defaultBranch,
      },
    };
  }
  return {
    id: "git-project",
    tier: "required",
    status: "missing",
    label: "Git project",
    message: facts.git.message,
    details: {
      defaultBranch: facts.git.defaultBranch,
    },
  };
}

function harnessCheck(
  facts: SetupFacts,
  selectedHarness: SupportedHarnessId | undefined,
): SetupCheck {
  const available = facts.harnesses.filter((harness) => harness.status === "ok");
  if (available.length === 0) {
    return {
      id: "harness",
      tier: "required",
      status: "missing",
      label: "Agent CLI",
      message: "Install one supported harness CLI: codex, cursor agent, opencode, or pi.",
    };
  }
  const selected = available.find((harness) => harness.id === selectedHarness) ?? available[0];
  const details: Record<string, string> = {
    available: available.map((harness) => harness.id).join(","),
  };
  if (selected !== undefined) {
    details.selected = selected.id;
    details.command = selected.command;
  }
  return {
    id: "harness",
    tier: "required",
    status: "ok",
    label: "Agent CLI",
    message:
      selected === undefined
        ? "A supported harness CLI is available."
        : `${selected.label} is selected for first-run config.`,
    details,
  };
}

function configCheck(facts: SetupFacts): SetupCheck {
  if (facts.config.status === "missing") {
    return {
      id: "config",
      tier: "required",
      status: "missing",
      label: "WOSM project config",
      message: facts.config.message,
      details: { path: facts.config.path },
    };
  }
  if (facts.config.status === "invalid") {
    return {
      id: "config",
      tier: "required",
      status: "warning",
      label: "WOSM project config",
      message: facts.config.message,
      details: { path: facts.config.path },
    };
  }
  if (!facts.config.hasProjectForRoot) {
    return {
      id: "config",
      tier: "required",
      status: "missing",
      label: "WOSM project config",
      message: "Config exists but does not include the current git repository.",
      details: { path: facts.config.path },
    };
  }
  return {
    id: "config",
    tier: "required",
    status: "ok",
    label: "WOSM project config",
    message: "Config includes the current git repository.",
    details: { path: facts.config.path },
  };
}

function setupActions(
  facts: SetupFacts,
  selectedHarness: SetupHarnessFact | undefined,
  configWrite: ConfigWritePlan | undefined,
): SetupAction[] {
  const actions: SetupAction[] = [];
  if (facts.worktrunk.status === "missing") {
    actions.push(installAction("install-worktrunk", "Worktrunk", "worktrunk", facts.brew));
  }
  if (facts.tmux.status === "missing") {
    actions.push(installAction("install-tmux", "tmux", "tmux", facts.brew));
  }
  actions.push({
    id: "worktrunk-shell-integration",
    kind: "run-command",
    tier: "recommended",
    selected: false,
    label: "Install Worktrunk shell integration",
    message: "Run wt config shell install after core setup if you want Worktrunk shell helpers.",
    command: [facts.worktrunk.command, "config", "shell", "install"],
  });

  const configActions = configWriteActions(facts, selectedHarness, configWrite);
  actions.push(...configActions);
  return actions;
}

function installAction(
  id: string,
  label: string,
  formula: string,
  brew: SetupFacts["brew"],
): SetupAction {
  const action: SetupAction = {
    id,
    kind: brew.status === "ok" ? "brew-install" : "noop",
    tier: "required",
    selected: brew.status === "ok",
    label: `Install ${label}`,
    message:
      brew.status === "ok"
        ? `Install ${label} with Homebrew.`
        : `Homebrew is unavailable; install ${label} manually with: brew install ${formula}`,
    command: ["brew", "install", formula],
    data: { formula },
  };
  return action;
}

function configWriteActions(
  facts: SetupFacts,
  selectedHarness: SetupHarnessFact | undefined,
  configWrite: ConfigWritePlan | undefined,
): SetupAction[] {
  if (selectedHarness === undefined || facts.git.status !== "ok") {
    return [];
  }
  if (configWrite === undefined || configWrite.operation === "none") {
    return [];
  }
  if (configWrite.operation === "blocked") {
    return [
      {
        id: "config-blocked",
        kind: "noop",
        tier: "required",
        selected: false,
        label: "Update WOSM config",
        message: configWrite.reason,
        path: configWrite.path,
      },
    ];
  }
  const mkdirAction: SetupAction = {
    id: "mkdir-config-dir",
    kind: "mkdir",
    tier: "required",
    selected: true,
    label: "Create config directory",
    message: "Create the parent directory for the WOSM config file.",
    path: configWrite.path,
  };
  const writeAction: SetupAction = {
    id: configWrite.operation === "create" ? "write-config" : "append-config",
    kind: "write-config",
    tier: "required",
    selected: true,
    label: configWrite.operation === "create" ? "Write WOSM config" : "Append WOSM config",
    message:
      configWrite.operation === "create"
        ? "Create the core WOSM config for this repository."
        : "Append safe missing setup blocks to the existing WOSM config.",
    path: configWrite.path,
    data: {
      operation: configWrite.operation,
      content: configWrite.content,
      ...(configWrite.operation === "append" ? { appendedText: configWrite.appendedText } : {}),
      ...(configWrite.backupPath === undefined ? {} : { backupPath: configWrite.backupPath }),
    },
  };
  return [mkdirAction, writeAction];
}

function nextSteps(requiredMissing: number, facts: SetupFacts): string[] {
  if (requiredMissing === 0) {
    return ["wosm doctor", "wosm tui"];
  }
  if (facts.worktrunk.status === "missing") {
    return ["Install Worktrunk, then run: wosm setup check"];
  }
  if (facts.tmux.status === "missing") {
    return ["Install tmux, then run: wosm setup check"];
  }
  if (facts.git.status === "missing") {
    return ["Run wosm setup from inside the git repository you want to manage."];
  }
  return ["Resolve the missing required setup items, then run: wosm setup check"];
}
