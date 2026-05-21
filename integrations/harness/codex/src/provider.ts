import type {
  BuildHarnessLaunchRequest,
  HarnessCapabilities,
  HarnessClassificationContext,
  HarnessDiscoveryContext,
  HarnessLaunchPlan,
  HarnessProvider,
  HarnessRunObservation,
  HarnessStatusObservation,
  ProviderHealth,
} from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { classifyCodexSkeletonRun } from "./classify.js";
import { buildCodexLaunchPlan } from "./launch.js";

export type CodexHarnessProviderOptions = {
  command?: string;
  now?: () => Date | string;
};

const capabilities: HarnessCapabilities = {
  canLaunch: true,
  canDiscoverRuns: true,
  canEmitEvents: false,
  canClassifyStatus: true,
  canReceivePrompt: false,
  canResume: false,
  canStop: false,
  canRunNonInteractive: true,
  canExposeApprovalState: false,
};

export class CodexHarnessProvider implements HarnessProvider {
  readonly id = "codex";

  readonly #options: CodexHarnessProviderOptions;

  constructor(options: CodexHarnessProviderOptions = {}) {
    this.#options = options;
  }

  capabilities(): HarnessCapabilities {
    return capabilities;
  }

  async health(): Promise<ProviderHealth> {
    return {
      providerId: this.id,
      providerType: "harness",
      status: "unknown",
      lastCheckedAt: now(this.#options),
      capabilities,
    };
  }

  async buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan> {
    return buildCodexLaunchPlan(request, {
      ...(this.#options.command === undefined ? {} : { command: this.#options.command }),
    });
  }

  async discoverRuns(_context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]> {
    return [];
  }

  async classifyRun(
    run: HarnessRunObservation,
    _context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation> {
    return classifyCodexSkeletonRun(run);
  }
}

function now(options: CodexHarnessProviderOptions): string {
  const value = options.now?.() ?? systemClock.now();
  return toIsoTimestamp(value instanceof Date ? value : new Date(value));
}
