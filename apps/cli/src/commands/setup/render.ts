import type { SetupAction, SetupCheck, SetupPlan, SetupTier } from "./model.js";

const tierHeadings: Record<SetupTier, string> = {
  required: "Core",
  recommended: "Recommended",
  optional: "Later",
};

const statusLabels: Record<SetupCheck["status"], string> = {
  ok: "ok",
  missing: "missing",
  warning: "warn",
  skipped: "skip",
};

export function renderSetupPlan(plan: SetupPlan): string {
  const lines: string[] = [];
  lines.push(`wosm setup ${plan.mode}`);
  lines.push("");
  for (const tier of ["required", "recommended", "optional"] as const) {
    const checks = plan.checks.filter((check) => check.tier === tier);
    if (checks.length === 0) continue;
    lines.push(`${tierHeadings[tier]}:`);
    for (const check of checks) {
      lines.push(`  ${statusLabels[check.status].padEnd(7)} ${check.label} - ${check.message}`);
    }
    lines.push("");
  }

  if (plan.actions.length > 0) {
    lines.push("Actions:");
    for (const action of plan.actions) {
      lines.push(renderAction(action));
    }
    lines.push("");
  }

  if (plan.nextSteps.length > 0) {
    lines.push("Next:");
    for (const step of plan.nextSteps) {
      lines.push(`  ${step}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderSetupApplyResult(plan: SetupPlan): string {
  if (plan.summary.requiredOk) {
    return ["Core setup complete.", "", "Next:", "  wosm doctor", "  wosm tui", ""].join("\n");
  }
  const missing = plan.checks.find(
    (check) => check.tier === "required" && check.status === "missing",
  );
  if (missing?.id === "worktrunk") {
    return ["Worktrunk is still missing. Install it, then run:", "  wosm setup check", ""].join(
      "\n",
    );
  }
  if (missing?.id === "tmux") {
    return ["tmux is still missing. Install it, then run:", "  wosm setup check", ""].join("\n");
  }
  if (missing?.id === "harness") {
    return [
      "No supported agent CLI is available. Install codex, cursor agent, opencode, or pi, then run:",
      "  wosm setup check",
      "",
    ].join("\n");
  }
  return [
    "Core setup is incomplete. Resolve the missing item, then run:",
    "  wosm setup check",
    "",
  ].join("\n");
}

function renderAction(action: SetupAction): string {
  const marker = action.selected ? "will" : "skip";
  const command = action.command === undefined ? "" : ` (${action.command.join(" ")})`;
  return `  ${marker.padEnd(4)} ${action.label} - ${action.message}${command}`;
}
