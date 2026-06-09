import { applySetupPlan } from "../apply.js";
import { planSetupConfigWrite } from "../configWriter.js";
import {
  actionById,
  applyOptions,
  collectForCommand,
  coreReadyForConfigWrite,
  isConfigAction,
  isInstallAction,
  markRequiredIncomplete,
} from "../flowUtils.js";
import {
  harnessInstallPlan,
  isHarnessInstallAction,
  missingHarnessInstallActions,
} from "../harnessInstall.js";
import { isSupportedHarnessId } from "../harnessSelection.js";
import { defaultPrompt, renderOptions, write } from "../io.js";
import type { SetupAction, SetupFacts } from "../model.js";
import { buildSetupPlan } from "../planner.js";
import { formatCommand, renderSetupApplyResult, renderSetupPlan } from "../render.js";
import type {
  SetupCommandDeps,
  SetupCommandOptions,
  SetupCommandResult,
  SetupPromptAdapter,
} from "../types.js";

export async function runGuidedSetup(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
): Promise<SetupCommandResult> {
  const prompt = deps.prompt ?? defaultPrompt();
  try {
    return await runGuidedSetupWithPrompt(options, deps, prompt);
  } finally {
    await prompt.close?.();
  }
}

async function runGuidedSetupWithPrompt(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
  prompt: SetupPromptAdapter,
): Promise<SetupCommandResult> {
  await write(deps, "Core setup: Worktrunk + tmux + one agent + first project.\n\n");
  let facts = await collectForCommand("apply", options, deps, {});
  let plan = buildSetupPlan(facts, { configWrite: await planSetupConfigWrite(facts) });
  await write(deps, renderSetupPlan(plan, renderOptions(deps)));

  const installActions = plan.actions.filter(isInstallAction).filter((action) => action.selected);
  if (installActions.length > 0) {
    const accepted = await prompt.confirm("Install missing required tools?");
    if (!accepted) {
      await write(deps, "No changes made.\n");
      return { code: 1 };
    }
    const installResult = await applySetupPlan(
      plan,
      applyOptions(deps, {
        actionFilter: isInstallAction,
        announceActions: true,
        showCommandOutput: true,
      }),
    );
    if (installResult.failedAction !== undefined) {
      await write(
        deps,
        renderSetupApplyResult(markRequiredIncomplete(installResult.plan), renderOptions(deps)),
      );
      return { code: 1 };
    }
    facts = await collectForCommand("apply", options, deps, {});
  }

  const harnessFacts = await ensureHarnessAvailable(options, deps, prompt, facts);
  if (harnessFacts === undefined) {
    return { code: 1 };
  }
  facts = harnessFacts;

  const availableHarnesses = facts.harnesses.filter((harness) => harness.status === "ok");
  if (availableHarnesses.length === 0) {
    const noHarnessPlan = buildSetupPlan(facts);
    await write(deps, renderSetupApplyResult(noHarnessPlan, renderOptions(deps)));
    return { code: 1 };
  }
  if (availableHarnesses.length > 1) {
    const selected = await prompt.select(
      "Select the agent CLI to enable.",
      availableHarnesses.map((harness) => ({ value: harness.id, label: harness.label })),
    );
    if (isSupportedHarnessId(selected)) {
      facts = { ...facts, selectedHarness: selected };
    }
  }

  const configWrite = await planSetupConfigWrite(facts);
  plan = buildSetupPlan(facts, { configWrite });
  if (!coreReadyForConfigWrite(plan)) {
    await write(deps, renderSetupApplyResult(plan, renderOptions(deps)));
    return { code: 1 };
  }

  const configActions = plan.actions.filter(isConfigAction).filter((action) => action.selected);
  if (configActions.length > 0) {
    const accepted = await prompt.confirm("Write WOSM project config?");
    if (!accepted) {
      await write(deps, "Config was not written.\n");
      return { code: 1 };
    }
    const writeResult = await applySetupPlan(
      plan,
      applyOptions(deps, { actionFilter: isConfigAction, announceActions: true }),
    );
    if (writeResult.failedAction !== undefined) {
      await write(deps, "Config write failed. Run: wosm setup plan\n");
      return { code: 1 };
    }
  }

  const shellIntegration = plan.actions.find(
    (action) => action.id === "worktrunk-shell-integration",
  );
  if (shellIntegration !== undefined) {
    const accepted = await prompt.confirm("Install Worktrunk shell integration?");
    if (accepted) {
      await applySetupPlan(
        { ...plan, actions: [{ ...shellIntegration, selected: true }] },
        applyOptions(deps, { announceActions: true, showCommandOutput: true }),
      );
    }
  }

  const tmuxPopupBinding = actionById(plan, "tmux-popup-binding");
  if (tmuxPopupBinding !== undefined) {
    const accepted = await prompt.confirm("Install tmux popup binding?");
    if (accepted) {
      await applySetupPlan(
        { ...plan, actions: [{ ...tmuxPopupBinding, selected: true }] },
        applyOptions(deps, { announceActions: true }),
      );
    }
  }

  await write(
    deps,
    renderSetupApplyResult(
      { ...plan, summary: { ...plan.summary, requiredOk: true } },
      renderOptions(deps),
    ),
  );
  return { code: 0 };
}

async function ensureHarnessAvailable(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
  prompt: SetupPromptAdapter,
  facts: SetupFacts,
): Promise<SetupFacts | undefined> {
  if (facts.harnesses.some((harness) => harness.status === "ok")) {
    return facts;
  }

  await write(
    deps,
    [
      "",
      "No supported agent CLI is available.",
      "WOSM needs one agent CLI. You can install one or more now.",
      "",
    ].join("\n"),
  );

  const selectedActions: SetupAction[] = [];
  for (const action of missingHarnessInstallActions(facts.harnesses)) {
    const command = action.command === undefined ? action.label : formatCommand(action.command);
    const accepted = await prompt.confirm(`${action.label}? (${command})`);
    if (accepted) {
      selectedActions.push({ ...action, selected: true });
    }
  }

  if (selectedActions.length === 0) {
    await write(
      deps,
      [
        "No agent CLI was installed.",
        "Install one supported agent CLI, then run:",
        "  wosm setup",
        "",
      ].join("\n"),
    );
    return undefined;
  }

  const result = await applySetupPlan(
    harnessInstallPlan(facts, selectedActions),
    applyOptions(deps, {
      actionFilter: isHarnessInstallAction,
      announceActions: true,
      showCommandOutput: true,
    }),
  );
  if (result.failedAction !== undefined) {
    await write(deps, "Agent CLI install failed. Fix the install error, then run: wosm setup\n");
    return undefined;
  }

  const refreshedFacts = await collectForCommand(
    "apply",
    options,
    depsWithUserBinPath(deps, facts),
    {},
  );
  if (refreshedFacts.harnesses.some((harness) => harness.status === "ok")) {
    return refreshedFacts;
  }

  await write(
    deps,
    [
      "No supported agent CLI was detected after install.",
      "Make sure the installed CLI is on PATH, then run:",
      "  wosm setup",
      "",
    ].join("\n"),
  );
  return undefined;
}

function depsWithUserBinPath(deps: SetupCommandDeps, facts: SetupFacts): SetupCommandDeps {
  const env = { ...(deps.env ?? process.env) };
  env.PATH = prependPath(`${facts.homeDir}/.local/bin`, env.PATH);
  return { ...deps, env };
}

function prependPath(path: string, existing: string | undefined): string {
  if (existing === undefined || existing.length === 0) {
    return path;
  }
  return existing.split(":").includes(path) ? existing : `${path}:${existing}`;
}
