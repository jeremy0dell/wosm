import { tmuxPopupBindingBlock } from "./checks/tmuxBinding.js";
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
    (check) => check.tier === "required" && check.status !== "ok",
  ).length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const summary = {
    requiredOk: checks.every((check) => check.tier !== "required" || check.status === "ok"),
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
      id: "tmux-popup-binding",
      tier: "recommended",
      status:
        facts.tmux.status === "ok"
          ? facts.tmuxBinding.status === "ok"
            ? "ok"
            : "warning"
          : "skipped",
      label: "tmux popup binding",
      message:
        facts.tmux.status === "ok"
          ? facts.tmuxBinding.status === "ok"
            ? "tmux popup binding is installed."
            : "Recommended: add Ctrl-b Space binding for the WOSM popup dashboard."
          : "Skipped until tmux is available.",
      details: { path: facts.tmuxBinding.path },
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
      status: "missing",
      label: "WOSM project config",
      message: facts.config.message,
      details: { path: facts.config.path },
    };
  }
  const supportedHarnesses = new Set(
    facts.harnesses.filter((harness) => harness.status === "ok").map((harness) => harness.id),
  );
  if (!facts.config.hasProjectForRoot) {
    const defaultCoreProblem = defaultConfigCoreProblem(facts.config, supportedHarnesses);
    if (defaultCoreProblem !== undefined) {
      return {
        id: "config",
        tier: "required",
        status: "missing",
        label: "WOSM project config",
        message: defaultCoreProblem,
        details: {
          path: facts.config.path,
          worktreeProvider: facts.config.defaults.worktreeProvider,
          terminal: facts.config.defaults.terminal,
          harness: facts.config.defaults.harness,
        },
      };
    }
    return {
      id: "config",
      tier: "required",
      status: "missing",
      label: "WOSM project config",
      message: "Config exists but does not include the current git repository.",
      details: { path: facts.config.path },
    };
  }
  const project = facts.config.matchedProject;
  if (project === undefined) {
    return {
      id: "config",
      tier: "required",
      status: "missing",
      label: "WOSM project config",
      message: "Config includes the current git repository, but setup could not inspect it.",
      details: { path: facts.config.path },
    };
  }
  const projectCoreProblem = projectConfigCoreProblem(project, supportedHarnesses);
  if (projectCoreProblem !== undefined) {
    return {
      id: "config",
      tier: "required",
      status: "missing",
      label: "WOSM project config",
      message: projectCoreProblem,
      details: {
        path: facts.config.path,
        project: project.id,
        worktreeProvider: project.worktreeProvider,
        terminal: project.terminal,
        harness: project.harness,
      },
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

function defaultConfigCoreProblem(
  config: Extract<SetupFacts["config"], { status: "valid" }>,
  supportedHarnesses: ReadonlySet<string>,
): string | undefined {
  if (config.defaults.worktreeProvider !== "worktrunk") {
    return `Config defaults use worktree provider ${config.defaults.worktreeProvider}; set defaults.worktree_provider to "worktrunk" before setup can append this project safely.`;
  }
  if (config.defaults.terminal !== "tmux") {
    return `Config defaults use terminal ${config.defaults.terminal}; set defaults.terminal to "tmux" before setup can append this project safely.`;
  }
  if (!supportedHarnesses.has(config.defaults.harness)) {
    return `Config defaults use harness ${config.defaults.harness}, but setup did not detect that supported harness CLI.`;
  }
  return undefined;
}

function projectConfigCoreProblem(
  project: NonNullable<Extract<SetupFacts["config"], { status: "valid" }>["matchedProject"]>,
  supportedHarnesses: ReadonlySet<string>,
): string | undefined {
  if (project.worktreeProvider !== "worktrunk") {
    return `Project ${project.id} uses worktree provider ${project.worktreeProvider}; set the effective provider to "worktrunk" for the setup core path.`;
  }
  if (!project.worktrunkEnabled) {
    return `Project ${project.id} disables Worktrunk; enable project Worktrunk config for the setup core path.`;
  }
  if (project.terminal !== "tmux") {
    return `Project ${project.id} uses terminal ${project.terminal}; set the effective terminal to "tmux" for the setup core path.`;
  }
  if (!supportedHarnesses.has(project.harness)) {
    return `Project ${project.id} uses harness ${project.harness}, but setup did not detect that supported harness CLI.`;
  }
  return undefined;
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
    command: [facts.worktrunk.command, "-y", "config", "shell", "install"],
  });
  if (facts.tmux.status === "ok" && facts.tmuxBinding.status === "missing") {
    actions.push({
      id: "tmux-popup-binding",
      kind: "append-file",
      tier: "recommended",
      selected: false,
      label: "Install tmux popup binding",
      message: "Append a Ctrl-b Space binding for the WOSM popup dashboard to ~/.tmux.conf.",
      path: facts.tmuxBinding.path,
      data: {
        marker: facts.tmuxBinding.marker,
        appendedText: tmuxPopupBindingBlock(),
      },
    });
  }

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
    return ["wosm doctor", "wosm"];
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
