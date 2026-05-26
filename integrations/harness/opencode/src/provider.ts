import type {
  BuildHarnessLaunchRequest,
  HarnessCapabilities,
  HarnessClassificationContext,
  HarnessDiscoveryContext,
  HarnessLaunchPlan,
  HarnessPermissionMode,
  HarnessProvider,
  HarnessRunObservation,
  HarnessStatusObservation,
  ProviderHealth,
} from "@wosm/contracts";
import { systemClock, toIsoTimestamp } from "@wosm/runtime";
import { classifyOpenCodeSkeletonRun } from "./classify.js";
import { buildOpenCodeLaunchPlan } from "./launch.js";

export type OpenCodeHarnessProviderOptions = {
  command?: string;
  permissionMode?: HarnessPermissionMode;
  approvalPolicy?: string;
  sandboxMode?: string;
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

export class OpenCodeHarnessProvider implements HarnessProvider {
  readonly id = "opencode";

  readonly #options: OpenCodeHarnessProviderOptions;

  constructor(options: OpenCodeHarnessProviderOptions = {}) {
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
    const options: Parameters<typeof buildOpenCodeLaunchPlan>[1] = {};
    if (this.#options.command !== undefined) {
      options.command = this.#options.command;
    }
    if (this.#options.permissionMode !== undefined) {
      options.defaultPermissionMode = this.#options.permissionMode;
    }
    if (this.#options.approvalPolicy !== undefined) {
      options.defaultApprovalPolicy = this.#options.approvalPolicy;
    }
    if (this.#options.sandboxMode !== undefined) {
      options.defaultSandboxMode = this.#options.sandboxMode;
    }
    return buildOpenCodeLaunchPlan(request, options);
  }

  async discoverRuns(_context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]> {
    return [];
  }

  async classifyRun(
    run: HarnessRunObservation,
    _context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation> {
    return classifyOpenCodeSkeletonRun(run);
  }
}

function now(options: OpenCodeHarnessProviderOptions): string {
  const value = options.now?.() ?? systemClock.now();
  return toIsoTimestamp(value instanceof Date ? value : new Date(value));
}
