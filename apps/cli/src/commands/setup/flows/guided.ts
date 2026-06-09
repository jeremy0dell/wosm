import { applySetupPlan } from "../apply.js";
import { planSetupConfigWrite } from "../configWriter.js";
import {
  applyOptions,
  collectForCommand,
  coreReadyForConfigWrite,
  isConfigAction,
  isInstallAction,
  markRequiredIncomplete,
} from "../flowUtils.js";
import { isSupportedHarnessId } from "../harnessSelection.js";
import { defaultPrompt, write } from "../io.js";
import { buildSetupPlan } from "../planner.js";
import { renderSetupApplyResult, renderSetupPlan } from "../render.js";
import type { SetupCommandDeps, SetupCommandOptions, SetupCommandResult } from "../types.js";

export async function runGuidedSetup(
  options: SetupCommandOptions,
  deps: SetupCommandDeps,
): Promise<SetupCommandResult> {
  const prompt = deps.prompt ?? defaultPrompt();
  await write(deps, "Core setup: Worktrunk + tmux + one agent + first project.\n\n");
  let facts = await collectForCommand("apply", options, deps, {});
  let plan = buildSetupPlan(facts, { configWrite: await planSetupConfigWrite(facts) });
  await write(deps, renderSetupPlan(plan));

  const installActions = plan.actions.filter(isInstallAction).filter((action) => action.selected);
  if (installActions.length > 0) {
    const accepted = await prompt.confirm("Install missing required tools?");
    if (!accepted) {
      await write(deps, "No changes made.\n");
      return { code: 1 };
    }
    const installResult = await applySetupPlan(
      plan,
      applyOptions(deps, { actionFilter: isInstallAction }),
    );
    if (installResult.failedAction !== undefined) {
      await write(deps, renderSetupApplyResult(markRequiredIncomplete(installResult.plan)));
      return { code: 1 };
    }
    facts = await collectForCommand("apply", options, deps, {});
  }

  const availableHarnesses = facts.harnesses.filter((harness) => harness.status === "ok");
  if (availableHarnesses.length === 0) {
    const noHarnessPlan = buildSetupPlan(facts);
    await write(deps, renderSetupApplyResult(noHarnessPlan));
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
    await write(deps, renderSetupApplyResult(plan));
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
      applyOptions(deps, { actionFilter: isConfigAction }),
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
        applyOptions(deps, {}),
      );
    }
  }

  await write(
    deps,
    renderSetupApplyResult({ ...plan, summary: { ...plan.summary, requiredOk: true } }),
  );
  return { code: 0 };
}
