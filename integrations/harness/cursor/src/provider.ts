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
  ProviderHealth,
  RawHarnessEvent,
} from "@wosm/contracts";
import { discoverTerminalBoundHarnessRuns } from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  runExternalCommand,
  runRuntimeBoundary,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import { classifyCursorRunStatus } from "./classify.js";
import { cursorProviderErrorFromUnknown } from "./errors.js";
import { normalizeCursorRawEvent } from "./events.js";
import { buildCursorLaunchPlan, type CursorLaunchOptions } from "./launch.js";

export type CursorHarnessProviderOptions = {
  command?: string;
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
  canRunNonInteractive: false,
  canExposeApprovalState: false,
};

export class CursorHarnessProvider implements HarnessProvider {
  readonly id = "cursor";

  readonly #options: CursorHarnessProviderOptions;

  constructor(options: CursorHarnessProviderOptions = {}) {
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
          args: ["--version"],
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
          command: "agent --version succeeded",
          observation: "hooks",
        },
      };
    } catch (error) {
      return {
        providerId: this.id,
        providerType: "harness",
        status: "unavailable",
        lastCheckedAt: checkedAt,
        lastError: cursorProviderErrorFromUnknown(error, {
          code: "HARNESS_CURSOR_UNAVAILABLE",
          message: "Cursor Agent is not available.",
          hint: "Install Cursor Agent or configure [harness.cursor].command.",
        }),
        capabilities,
      };
    }
  }

  async buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan> {
    const options: CursorLaunchOptions = {
      command: command(this.#options),
    };
    return buildCursorLaunchPlan(request, options);
  }

  async discoverRuns(context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]> {
    return discoverTerminalBoundHarnessRuns(context, {
      harnessProvider: this.id,
      displayName: "Cursor",
      role: "main-agent",
    });
  }

  async classifyRun(
    run: HarnessRunObservation,
    _context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation> {
    return classifyCursorRunStatus(run);
  }

  async ingestEvent(
    event: RawHarnessEvent,
    context: HarnessEventContext,
  ): Promise<HarnessEventObservation[]> {
    const result = await runRuntimeBoundary(
      {
        operation: "provider.cursor.ingestEvent",
        error: {
          tag: "HarnessProviderError",
          code: "HARNESS_CURSOR_EVENT_INGEST_FAILED",
          message: "The Cursor harness provider failed to ingest an event.",
          provider: this.id,
        },
      },
      async () => normalizeCursorRawEvent(event, context),
    );
    if (!result.ok) {
      throw result.error;
    }
    return result.value;
  }
}

function command(options: CursorHarnessProviderOptions): string {
  return options.command ?? process.env.WOSM_CURSOR_AGENT_BIN ?? "agent";
}

function now(options: CursorHarnessProviderOptions): string {
  const value = options.now?.() ?? systemClock.now();
  return toIsoTimestamp(value instanceof Date ? value : new Date(value));
}
