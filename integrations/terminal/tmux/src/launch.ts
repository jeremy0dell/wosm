import type { HarnessLaunchPlan, TerminalLaunchProcessRequest } from "@wosm/contracts";

export function renderHarnessLaunchCommand(plan: HarnessLaunchPlan): string {
  const cwd = plan.cwd === undefined ? "" : `cd ${quoteArg(plan.cwd)} && `;
  const env = Object.entries(plan.env ?? {});
  const envPrefix =
    env.length === 0 ? "" : `env ${env.map(([key, value]) => quoteEnv(key, value)).join(" ")} `;
  const args = plan.args.map(quoteArg);
  return [cwd + envPrefix + quoteCommand(plan.command), ...args].join(" ");
}

export function resolveLaunchPaneTarget(request: TerminalLaunchProcessRequest): string {
  const providerData = isRecord(request.terminalTarget.providerData)
    ? request.terminalTarget.providerData
    : {};
  return typeof providerData.paneTarget === "string"
    ? providerData.paneTarget
    : request.agentEndpointId;
}

function quoteEnv(key: string, value: string): string {
  return shellQuote(`${key}=${value}`);
}

function quoteCommand(value: string): string {
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : shellQuote(value);
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_@%+=,.-]+$/.test(value) ? value : shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
