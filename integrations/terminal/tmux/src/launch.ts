import type { HarnessLaunchPlan, TerminalLaunchProcessRequest } from "@wosm/contracts";
import { z } from "zod";

export const TmuxLaunchPaneProviderDataSchema = z
  .object({
    paneTarget: z.string().min(1),
  })
  .passthrough();

export function renderHarnessLaunchCommand(plan: HarnessLaunchPlan): string {
  const cwd = plan.cwd === undefined ? "" : `cd ${quoteArg(plan.cwd)} && `;
  const env = Object.entries(plan.env ?? {});
  const envPrefix =
    env.length === 0 ? "" : `env ${env.map(([key, value]) => quoteEnv(key, value)).join(" ")} `;
  const args = plan.args.map(quoteArg);
  return [cwd + envPrefix + quoteCommand(plan.command), ...args].join(" ");
}

export function resolveLaunchPaneTarget(request: TerminalLaunchProcessRequest): string {
  const providerData = TmuxLaunchPaneProviderDataSchema.safeParse(
    request.terminalTarget.providerData,
  );
  return providerData.success ? providerData.data.paneTarget : request.agentEndpointId;
}

function quoteEnv(key: string, value: string): string {
  return shellQuote(`${key}=${value}`);
}

// Commands and args have different safe character sets; keep command paths conservative.
function quoteCommand(value: string): string {
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : shellQuote(value);
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_@%+=,.-]+$/.test(value) ? value : shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
