import type {
  CreateWorktreeRequest,
  GetWorktreeRequest,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  RemoveWorktreeRequest,
  RemoveWorktreeResult,
  WorktreeCapabilities,
  WorktreeObservation,
  WorktreeProvider,
} from "@wosm/contracts";
import {
  type ExternalCommandRunner,
  type RuntimeClock,
  runExternalCommand,
  runRuntimeBoundary,
  systemClock,
  toIsoTimestamp,
} from "@wosm/runtime";
import {
  ProviderUnavailableError,
  providerErrorFromUnknown,
  WorktrunkProviderError,
} from "./errors.js";
import { applyRecoveryBreadcrumbMetadata } from "./metadata.js";
import { parseWorktrunkListJson, parseWorktrunkListPayload } from "./parse.js";

export type WorktrunkProviderOptions = {
  command?: string;
  configPath?: string;
  timeoutMs?: number;
  runner?: ExternalCommandRunner;
  clock?: RuntimeClock;
};

const defaultCapabilities: WorktreeCapabilities = {
  canCreate: true,
  canRemove: true,
  canList: true,
  canEmitLifecycleEvents: true,
  canExposeDirtyState: true,
};

export class WorktrunkProvider implements WorktreeProvider {
  readonly id: ProviderId = "worktrunk";

  readonly #command: string;
  readonly #configPath: string | undefined;
  readonly #timeoutMs: number;
  readonly #runner: ExternalCommandRunner | undefined;
  readonly #clock: RuntimeClock;
  readonly #observations = new Map<string, WorktreeObservation>();

  constructor(options: WorktrunkProviderOptions = {}) {
    this.#command = options.command ?? process.env.WOSM_WORKTRUNK_BIN ?? "wt";
    this.#configPath = options.configPath;
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#runner = options.runner;
    this.#clock = options.clock ?? systemClock;
  }

  capabilities(): WorktreeCapabilities {
    return defaultCapabilities;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = toIsoTimestamp(this.#clock.now());
    try {
      await this.#run(["--version"]);
      return {
        providerId: this.id,
        providerType: "worktree",
        status: "healthy",
        lastCheckedAt: checkedAt,
        capabilities: this.capabilities(),
      };
    } catch (cause) {
      const error = providerErrorFromUnknown(cause, {
        code: "WORKTRUNK_UNAVAILABLE",
        message: "Worktrunk is not available.",
        hint: "Install the wt binary or set worktree.worktrunk.command.",
      });
      return {
        providerId: this.id,
        providerType: "worktree",
        status: "unavailable",
        lastCheckedAt: checkedAt,
        lastError: error,
        capabilities: this.capabilities(),
      };
    }
  }

  async listWorktrees(project: ProviderProjectConfig): Promise<WorktreeObservation[]> {
    if (!project.worktrunk.enabled) {
      return [];
    }

    const output = await this.#run(this.#args(["list", "--format=json"]), project.root, {
      code: "WORKTRUNK_COMMAND_FAILED",
      message: "Worktrunk failed to list worktrees.",
    });
    const observations = parseWorktrunkListJson(output.stdout, {
      project,
      providerId: this.id,
      observedAt: toIsoTimestamp(this.#clock.now()),
    });
    const withBreadcrumbs = await Promise.all(
      observations.map((observation) => applyRecoveryBreadcrumbMetadata(observation, project)),
    );
    for (const observation of withBreadcrumbs) {
      this.#observations.set(observation.id, observation);
    }
    return withBreadcrumbs;
  }

  async createWorktree(request: CreateWorktreeRequest): Promise<WorktreeObservation> {
    const base = request.base ?? request.project.worktrunk.base;
    const output = await this.#run(
      this.#args([
        "switch",
        "--create",
        request.branch,
        ...(base === undefined ? [] : ["--base", base]),
        "--no-cd",
        "--format=json",
      ]),
      request.project.root,
      {
        code: "WORKTRUNK_COMMAND_FAILED",
        message: "Worktrunk failed to create a worktree.",
      },
    );

    const observations = parseCommandObservation(output.stdout, {
      project: request.project,
      providerId: this.id,
      observedAt: toIsoTimestamp(this.#clock.now()),
    });
    const found =
      observations.find((observation) => observation.branch === request.branch) ??
      observations.find((observation) => observation.path === request.path) ??
      (await this.listWorktrees(request.project)).find(
        (observation) => observation.branch === request.branch,
      );
    if (found === undefined) {
      throw new WorktrunkProviderError(
        "WORKTRUNK_INVALID_OUTPUT",
        "Worktrunk create did not return or list the created worktree.",
      );
    }
    this.#observations.set(found.id, found);
    return found;
  }

  async removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResult> {
    const observation = this.#observations.get(request.worktreeId);
    if (observation === undefined) {
      throw new WorktrunkProviderError(
        "WORKTRUNK_WORKTREE_NOT_FOUND",
        "Worktrunk remove requires a previously observed worktree.",
        { hint: "Run listWorktrees before removeWorktree so the provider can resolve the target." },
      );
    }

    await this.#run(
      this.#args([
        "remove",
        removeTarget(observation),
        ...(request.force === true ? ["--force"] : []),
        "--foreground",
        "--format=json",
      ]),
      observation.path,
      {
        code: "WORKTRUNK_COMMAND_FAILED",
        message: "Worktrunk failed to remove a worktree.",
      },
    );
    this.#observations.delete(request.worktreeId);
    return {
      worktreeId: request.worktreeId,
      removed: true,
    };
  }

  async getWorktree(request: GetWorktreeRequest): Promise<WorktreeObservation | null> {
    if (request.worktreeId !== undefined) {
      return this.#observations.get(request.worktreeId) ?? null;
    }
    if (request.path !== undefined) {
      return (
        [...this.#observations.values()].find((observation) => observation.path === request.path) ??
        null
      );
    }
    return null;
  }

  #args(args: string[]): string[] {
    return this.#configPath === undefined ? args : ["--config", this.#configPath, ...args];
  }

  async #run(
    args: string[],
    cwd?: string,
    fallback: {
      code: "WORKTRUNK_COMMAND_FAILED" | "WORKTRUNK_UNAVAILABLE";
      message: string;
    } = {
      code: "WORKTRUNK_UNAVAILABLE",
      message: "Worktrunk is not available.",
    },
  ) {
    const result = await runRuntimeBoundary(
      {
        operation: `provider.worktrunk.${args[0] ?? "command"}`,
        clock: this.#clock,
        error: {
          tag:
            fallback.code === "WORKTRUNK_UNAVAILABLE"
              ? "ProviderUnavailableError"
              : "WorktreeProviderError",
          code: fallback.code,
          message: fallback.message,
          provider: this.id,
        },
      },
      () =>
        runExternalCommand(
          {
            command: this.#command,
            args,
            ...(cwd === undefined ? {} : { cwd }),
            timeoutMs: this.#timeoutMs,
            maxOutputChars: 512 * 1024,
          },
          this.#runner,
        ),
    );

    if (result.ok) {
      return result.value;
    }

    try {
      throw result.error;
    } catch (cause) {
      if (isMissingBinary(cause)) {
        throw new ProviderUnavailableError("Worktrunk is not available.", {
          hint: "Install the wt binary or set worktree.worktrunk.command.",
          cause,
        });
      }
      throw providerErrorFromUnknown(cause, {
        code: fallback.code,
        message: fallback.message,
      });
    }
  }
}

function parseCommandObservation(
  stdout: string,
  options: {
    project: ProviderProjectConfig;
    providerId: ProviderId;
    observedAt: string;
  },
): WorktreeObservation[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  try {
    return parseWorktrunkListJson(trimmed, options);
  } catch {
    return parseWorktrunkListPayload(JSON.parse(trimmed), options);
  }
}

function removeTarget(observation: WorktreeObservation): string {
  return observation.branch.startsWith("detached:") ? observation.path : observation.branch;
}

function isMissingBinary(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const cause = error as { code?: unknown; cause?: unknown };
  return cause.code === "ENOENT" || isMissingBinary(cause.cause);
}
