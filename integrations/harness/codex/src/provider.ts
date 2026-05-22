import type {
  BuildHarnessLaunchRequest,
  HarnessCapabilities,
  HarnessClassificationContext,
  HarnessDiscoveryContext,
  HarnessEventContext,
  HarnessEventObservation,
  HarnessLaunchPlan,
  HarnessProvider,
  HarnessRunObservation,
  HarnessStatusObservation,
  ProviderDoctorCheck,
  ProviderDoctorContext,
  ProviderHealth,
  RawHarnessEvent,
} from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  runExternalCommand,
  runRuntimeBoundary,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { classifyCodexRunStatus } from "./classify.js";
import { discoverCodexRuns } from "./discovery.js";
import { codexProviderErrorFromUnknown } from "./errors.js";
import { normalizeCodexRawEvent } from "./events.js";
import { buildCodexLaunchPlan } from "./launch.js";

export type CodexHarnessProviderOptions = {
  command?: string;
  profile?: string;
  approvalPolicy?: string;
  sandboxMode?: string;
  noAltScreen?: boolean;
  now?: () => Date | string;
  timeoutMs?: number;
  runner?: ExternalCommandRunner;
};

const capabilities: HarnessCapabilities = {
  canLaunch: true,
  canDiscoverRuns: true,
  canEmitEvents: true,
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
    const checkedAt = now(this.#options);
    try {
      await runExternalCommand(
        {
          command: command(this.#options),
          args: ["login", "status"],
          timeoutMs: this.#options.timeoutMs ?? 5000,
          maxOutputChars: 4096,
        },
        this.#options.runner,
      );
      return {
        providerId: this.id,
        providerType: "harness",
        status: "healthy",
        lastCheckedAt: checkedAt,
        capabilities,
        diagnostics: {
          auth: "codex login status succeeded",
        },
      };
    } catch (error) {
      return {
        providerId: this.id,
        providerType: "harness",
        status: "unavailable",
        lastCheckedAt: checkedAt,
        lastError: codexProviderErrorFromUnknown(error, {
          code: "HARNESS_CODEX_UNAVAILABLE",
          message: "Codex is not available or is not logged in.",
          hint: "Install Codex and run `codex login status` to verify authentication.",
        }),
        capabilities,
      };
    }
  }

  async doctorChecks(_context?: ProviderDoctorContext): Promise<ProviderDoctorCheck[]> {
    const health = await this.health();
    if (health.status === "healthy") {
      return [
        {
          name: "codex.login",
          status: "ok",
          message: "Codex authentication is available.",
        },
      ];
    }
    const check: ProviderDoctorCheck = {
      name: "codex.login",
      status: "error",
      message: "Codex is unavailable or not authenticated.",
    };
    if (health.lastError !== undefined) {
      check.error = health.lastError;
    }
    return [check];
  }

  async buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan> {
    return buildCodexLaunchPlan(request, {
      command: command(this.#options),
      ...(this.#options.profile === undefined ? {} : { defaultProfile: this.#options.profile }),
      ...(this.#options.approvalPolicy === undefined
        ? {}
        : { defaultApprovalPolicy: this.#options.approvalPolicy }),
      ...(this.#options.sandboxMode === undefined
        ? {}
        : { defaultSandboxMode: this.#options.sandboxMode }),
      ...(this.#options.noAltScreen === undefined
        ? {}
        : { noAltScreen: this.#options.noAltScreen }),
    });
  }

  async discoverRuns(context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]> {
    return discoverCodexRuns(context);
  }

  async classifyRun(
    run: HarnessRunObservation,
    _context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation> {
    return classifyCodexRunStatus(run);
  }

  async ingestEvent(
    event: RawHarnessEvent,
    context: HarnessEventContext,
  ): Promise<HarnessEventObservation[]> {
    const result = await runRuntimeBoundary(
      {
        operation: "provider.codex.ingestEvent",
        error: {
          tag: "HarnessProviderError",
          code: "HARNESS_CODEX_EVENT_INGEST_FAILED",
          message: "The Codex harness provider failed to ingest an event.",
          provider: this.id,
        },
      },
      async () => normalizeCodexRawEvent(event, context),
    );
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  }
}

function command(options: CodexHarnessProviderOptions): string {
  return options.command ?? process.env.WOSM_CODEX_BIN ?? "codex";
}

function now(options: CodexHarnessProviderOptions): string {
  const value = options.now?.() ?? systemClock.now();
  return toIsoTimestamp(value instanceof Date ? value : new Date(value));
}
