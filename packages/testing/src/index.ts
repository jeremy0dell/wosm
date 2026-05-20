import type {
  BuildHarnessLaunchRequest,
  Confidence,
  CreateWorktreeRequest,
  GetWorktreeRequest,
  HarnessCapabilities,
  HarnessClassificationContext,
  HarnessDiscoveryContext,
  HarnessEventContext,
  HarnessEventObservation,
  HarnessLaunchPlan,
  HarnessProvider,
  HarnessRunObservation,
  HarnessStatusObservation,
  HarnessStopRequest,
  HarnessStopResult,
  OpenWorkspaceRequest,
  OpenWorkspaceResult,
  ProviderHealth,
  ProviderId,
  ProviderProjectConfig,
  RawHarnessEvent,
  RemoveWorktreeRequest,
  RemoveWorktreeResult,
  SafeError,
  TerminalCapabilities,
  TerminalCapture,
  TerminalProvider,
  TerminalState,
  TerminalTargetId,
  TerminalTargetObservation,
  WorktreeCapabilities,
  WorktreeId,
  WorktreeObservation,
  WorktreeProvider,
} from "@wosm/contracts";

export type FakeProviderTestkitPlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly providers: readonly string[];
};

export type ScriptedAgentLifecyclePlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly states: readonly string[];
};

export function createFakeProviderTestkitPlaceholder(): FakeProviderTestkitPlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    providers: ["fake-worktree", "fake-terminal", "fake-harness"],
  };
}

export function createScriptedAgentLifecyclePlaceholder(): ScriptedAgentLifecyclePlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    states: ["defined", "started", "stopped"],
  };
}

export type FakeProviderClock = string | (() => Date | string);

type FakeWorktreeProviderMethod =
  | "health"
  | "listWorktrees"
  | "createWorktree"
  | "removeWorktree"
  | "getWorktree";

type FakeTerminalProviderMethod =
  | "health"
  | "listTargets"
  | "openWorkspace"
  | "focusTarget"
  | "closeTarget"
  | "captureTarget"
  | "sendInput";

type FakeHarnessProviderMethod =
  | "health"
  | "buildLaunch"
  | "discoverRuns"
  | "classifyRun"
  | "ingestEvent"
  | "stop";

export type FakeProviderFailures<TMethod extends string> = Partial<Record<TMethod, SafeError>>;

export type CreateFakeWorktreeInput = {
  id?: WorktreeId;
  provider?: ProviderId;
  projectId?: string;
  branch?: string;
  path?: string;
  now?: FakeProviderClock;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  providerData?: unknown;
};

export type CreateFakeTerminalTargetInput = {
  id?: TerminalTargetId;
  provider?: ProviderId;
  projectId?: string;
  worktreeId?: WorktreeId;
  sessionId?: string;
  harnessRunId?: string;
  state?: TerminalState;
  confidence?: Confidence;
  reason?: string;
  now?: FakeProviderClock;
  providerData?: unknown;
};

export type CreateFakeHarnessRunInput = {
  id?: string;
  provider?: ProviderId;
  projectId?: string;
  worktreeId?: WorktreeId;
  sessionId?: string;
  state?: HarnessRunObservation["state"];
  confidence?: Confidence;
  reason?: string;
  pid?: number;
  now?: FakeProviderClock;
  providerData?: unknown;
};

export type FakeWorktreeProviderOptions = {
  id?: ProviderId;
  now?: FakeProviderClock;
  worktrees?: WorktreeObservation[];
  health?: Partial<ProviderHealth>;
  capabilities?: Partial<WorktreeCapabilities>;
  failures?: FakeProviderFailures<FakeWorktreeProviderMethod>;
};

export type FakeTerminalProviderOptions = {
  id?: ProviderId;
  now?: FakeProviderClock;
  targets?: TerminalTargetObservation[];
  health?: Partial<ProviderHealth>;
  capabilities?: Partial<TerminalCapabilities>;
  failures?: FakeProviderFailures<FakeTerminalProviderMethod>;
};

export type FakeHarnessProviderOptions = {
  id?: ProviderId;
  now?: FakeProviderClock;
  runs?: HarnessRunObservation[];
  health?: Partial<ProviderHealth>;
  capabilities?: Partial<HarnessCapabilities>;
  failures?: FakeProviderFailures<FakeHarnessProviderMethod>;
};

const defaultWorktreeCapabilities: WorktreeCapabilities = {
  canCreate: true,
  canRemove: true,
  canList: true,
  canEmitLifecycleEvents: true,
  canExposeDirtyState: true,
};

const defaultTerminalCapabilities: TerminalCapabilities = {
  canOpenWorkspace: true,
  canFocusTarget: true,
  canCloseTarget: true,
  canCaptureOutput: true,
  canSendInput: true,
  canPersistIdentityBinding: true,
  canDisplayPopup: true,
};

const defaultHarnessCapabilities: HarnessCapabilities = {
  canLaunch: true,
  canDiscoverRuns: true,
  canEmitEvents: true,
  canClassifyStatus: true,
  canReceivePrompt: false,
  canResume: true,
  canStop: true,
  canRunNonInteractive: true,
  canExposeApprovalState: true,
};

function resolveNow(clock?: FakeProviderClock): string {
  if (typeof clock === "function") {
    const value = clock();
    return value instanceof Date ? value.toISOString() : value;
  }

  return clock ?? new Date(0).toISOString();
}

function providerHealth(
  input: {
    providerId: ProviderId;
    providerType: ProviderHealth["providerType"];
    now?: FakeProviderClock;
    capabilities: Record<string, boolean>;
  },
  override?: Partial<ProviderHealth>,
): ProviderHealth {
  return {
    providerId: input.providerId,
    providerType: input.providerType,
    status: "healthy",
    lastCheckedAt: resolveNow(input.now),
    latencyMs: 0,
    capabilities: input.capabilities,
    ...override,
  };
}

function maybeThrow<TMethod extends string>(
  failures: FakeProviderFailures<TMethod> | undefined,
  method: TMethod,
): void {
  const failure = failures?.[method];
  if (failure !== undefined) {
    throw failure;
  }
}

function compactProviderData(providerData: unknown): { providerData?: unknown } {
  return providerData === undefined ? {} : { providerData };
}

export function createFakeWorktree(input: CreateFakeWorktreeInput = {}): WorktreeObservation {
  const projectId = input.projectId ?? "web";
  const branch = input.branch ?? "main";

  return {
    id: input.id ?? `wt_${projectId}_${branch.replaceAll(/[^a-zA-Z0-9]+/g, "_")}`,
    provider: input.provider ?? "fake-worktree",
    projectId,
    branch,
    path: input.path ?? `/tmp/wosm/${projectId}/${branch.replaceAll("/", "-")}`,
    state: "exists",
    source: "worktrunk",
    dirty: input.dirty ?? false,
    ahead: input.ahead ?? 0,
    behind: input.behind ?? 0,
    confidence: "high",
    reason: "Fake provider listed the worktree.",
    observedAt: resolveNow(input.now),
    ...compactProviderData(input.providerData),
  };
}

export function createFakeTerminalTarget(
  input: CreateFakeTerminalTargetInput = {},
): TerminalTargetObservation {
  const state = input.state ?? "open";

  return {
    id: input.id ?? "term_fake",
    provider: input.provider ?? "fake-terminal",
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.harnessRunId === undefined ? {} : { harnessRunId: input.harnessRunId }),
    state,
    confidence: input.confidence ?? (state === "unknown" ? "low" : "high"),
    reason: input.reason ?? "Fake provider listed the terminal target.",
    observedAt: resolveNow(input.now),
    ...compactProviderData(input.providerData),
  };
}

export function createFakeHarnessRun(input: CreateFakeHarnessRunInput = {}): HarnessRunObservation {
  const state = input.state ?? "idle";
  const pid = input.pid ?? (state === "exited" ? undefined : 5000);

  return {
    id: input.id ?? "run_fake",
    provider: input.provider ?? "fake-harness",
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.worktreeId === undefined ? {} : { worktreeId: input.worktreeId }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(pid === undefined ? {} : { pid }),
    state,
    confidence: input.confidence ?? (state === "unknown" ? "low" : "high"),
    reason: input.reason ?? `Fake harness run is ${state}.`,
    observedAt: resolveNow(input.now),
    ...compactProviderData(input.providerData),
  };
}

export class FakeWorktreeProvider implements WorktreeProvider {
  readonly id: ProviderId;

  readonly #now: FakeProviderClock | undefined;
  readonly #worktrees: WorktreeObservation[];
  readonly #health: Partial<ProviderHealth> | undefined;
  readonly #capabilities: WorktreeCapabilities;
  readonly #failures: FakeProviderFailures<FakeWorktreeProviderMethod> | undefined;

  constructor(options: FakeWorktreeProviderOptions = {}) {
    this.id = options.id ?? "fake-worktree";
    this.#now = options.now;
    this.#worktrees = options.worktrees ?? [];
    this.#health = options.health;
    this.#capabilities = {
      ...defaultWorktreeCapabilities,
      ...options.capabilities,
    };
    this.#failures = options.failures;
  }

  capabilities(): WorktreeCapabilities {
    return this.#capabilities;
  }

  async health(): Promise<ProviderHealth> {
    maybeThrow(this.#failures, "health");
    return providerHealth(
      {
        providerId: this.id,
        providerType: "worktree",
        capabilities: this.#capabilities,
        ...(this.#now === undefined ? {} : { now: this.#now }),
      },
      this.#health,
    );
  }

  async listWorktrees(project: ProviderProjectConfig): Promise<WorktreeObservation[]> {
    maybeThrow(this.#failures, "listWorktrees");
    return this.#worktrees.filter((worktree) => worktree.projectId === project.id);
  }

  async createWorktree(request: CreateWorktreeRequest): Promise<WorktreeObservation> {
    maybeThrow(this.#failures, "createWorktree");
    const worktree = createFakeWorktree({
      provider: this.id,
      projectId: request.project.id,
      branch: request.branch,
      ...(request.path === undefined ? {} : { path: request.path }),
      ...(this.#now === undefined ? {} : { now: this.#now }),
    });
    this.#worktrees.push(worktree);
    return worktree;
  }

  async removeWorktree(request: RemoveWorktreeRequest): Promise<RemoveWorktreeResult> {
    maybeThrow(this.#failures, "removeWorktree");
    const index = this.#worktrees.findIndex((worktree) => worktree.id === request.worktreeId);
    if (index >= 0) {
      this.#worktrees.splice(index, 1);
    }
    return {
      worktreeId: request.worktreeId,
      removed: index >= 0,
    };
  }

  async getWorktree(request: GetWorktreeRequest): Promise<WorktreeObservation | null> {
    maybeThrow(this.#failures, "getWorktree");
    return (
      this.#worktrees.find((worktree) => {
        if (request.worktreeId !== undefined) {
          return worktree.id === request.worktreeId;
        }
        if (request.path !== undefined) {
          return worktree.path === request.path;
        }
        return false;
      }) ?? null
    );
  }

  snapshot(): { worktrees: WorktreeObservation[] } {
    return {
      worktrees: [...this.#worktrees],
    };
  }
}

export class FakeTerminalProvider implements TerminalProvider {
  readonly id: ProviderId;

  readonly #now: FakeProviderClock | undefined;
  readonly #targets: TerminalTargetObservation[];
  readonly #health: Partial<ProviderHealth> | undefined;
  readonly #capabilities: TerminalCapabilities;
  readonly #failures: FakeProviderFailures<FakeTerminalProviderMethod> | undefined;

  constructor(options: FakeTerminalProviderOptions = {}) {
    this.id = options.id ?? "fake-terminal";
    this.#now = options.now;
    this.#targets = options.targets ?? [];
    this.#health = options.health;
    this.#capabilities = {
      ...defaultTerminalCapabilities,
      ...options.capabilities,
    };
    this.#failures = options.failures;
  }

  capabilities(): TerminalCapabilities {
    return this.#capabilities;
  }

  async health(): Promise<ProviderHealth> {
    maybeThrow(this.#failures, "health");
    return providerHealth(
      {
        providerId: this.id,
        providerType: "terminal",
        capabilities: this.#capabilities,
        ...(this.#now === undefined ? {} : { now: this.#now }),
      },
      this.#health,
    );
  }

  async listTargets(): Promise<TerminalTargetObservation[]> {
    maybeThrow(this.#failures, "listTargets");
    return [...this.#targets];
  }

  async openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult> {
    maybeThrow(this.#failures, "openWorkspace");
    const target = createFakeTerminalTarget({
      provider: this.id,
      projectId: request.project.id,
      worktreeId: request.worktree.id,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      ...(this.#now === undefined ? {} : { now: this.#now }),
    });
    this.#targets.push(target);
    return {
      target: {
        provider: this.id,
        targetId: target.id,
        projectId: request.project.id,
        worktreeId: request.worktree.id,
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        confidence: "high",
        reason: "Fake provider opened a workspace.",
      },
      agentEndpointId: target.id,
    };
  }

  async focusTarget(_targetId: TerminalTargetId): Promise<void> {
    maybeThrow(this.#failures, "focusTarget");
  }

  async closeTarget(targetId: TerminalTargetId): Promise<void> {
    maybeThrow(this.#failures, "closeTarget");
    const index = this.#targets.findIndex((target) => target.id === targetId);
    if (index >= 0) {
      this.#targets.splice(index, 1);
    }
  }

  async captureTarget(targetId: TerminalTargetId): Promise<TerminalCapture> {
    maybeThrow(this.#failures, "captureTarget");
    return {
      targetId,
      capturedAt: resolveNow(this.#now),
      text: "",
    };
  }

  async sendInput(_targetId: TerminalTargetId, _input: string): Promise<void> {
    maybeThrow(this.#failures, "sendInput");
  }

  snapshot(): { targets: TerminalTargetObservation[] } {
    return {
      targets: [...this.#targets],
    };
  }
}

export class FakeHarnessProvider implements HarnessProvider {
  readonly id: ProviderId;

  readonly #now: FakeProviderClock | undefined;
  readonly #runs: HarnessRunObservation[];
  readonly #health: Partial<ProviderHealth> | undefined;
  readonly #capabilities: HarnessCapabilities;
  readonly #failures: FakeProviderFailures<FakeHarnessProviderMethod> | undefined;

  constructor(options: FakeHarnessProviderOptions = {}) {
    this.id = options.id ?? "fake-harness";
    this.#now = options.now;
    this.#runs = options.runs ?? [];
    this.#health = options.health;
    this.#capabilities = {
      ...defaultHarnessCapabilities,
      ...options.capabilities,
    };
    this.#failures = options.failures;
  }

  capabilities(): HarnessCapabilities {
    return this.#capabilities;
  }

  async health(): Promise<ProviderHealth> {
    maybeThrow(this.#failures, "health");
    return providerHealth(
      {
        providerId: this.id,
        providerType: "harness",
        capabilities: this.#capabilities,
        ...(this.#now === undefined ? {} : { now: this.#now }),
      },
      this.#health,
    );
  }

  async buildLaunch(request: BuildHarnessLaunchRequest): Promise<HarnessLaunchPlan> {
    maybeThrow(this.#failures, "buildLaunch");
    return {
      provider: this.id,
      command: this.id,
      args: [request.project.id, request.worktree.branch],
      cwd: request.worktree.path,
      mode: request.mode ?? "interactive",
    };
  }

  async discoverRuns(_context: HarnessDiscoveryContext): Promise<HarnessRunObservation[]> {
    maybeThrow(this.#failures, "discoverRuns");
    return [...this.#runs];
  }

  async classifyRun(
    run: HarnessRunObservation,
    _context: HarnessClassificationContext,
  ): Promise<HarnessStatusObservation> {
    maybeThrow(this.#failures, "classifyRun");
    return {
      provider: this.id,
      runId: run.id,
      ...(run.projectId === undefined ? {} : { projectId: run.projectId }),
      ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
      ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
      status: {
        value: run.state,
        confidence: run.confidence,
        reason: run.reason,
        source: "harness_process",
        updatedAt: run.observedAt,
      },
      observedAt: resolveNow(this.#now),
    };
  }

  async ingestEvent(
    event: RawHarnessEvent,
    _context: HarnessEventContext,
  ): Promise<HarnessEventObservation[]> {
    maybeThrow(this.#failures, "ingestEvent");
    const observedAt = event.observedAt ?? resolveNow(this.#now);
    return this.#runs.map((run) => ({
      provider: this.id,
      runId: run.id,
      ...(run.worktreeId === undefined ? {} : { worktreeId: run.worktreeId }),
      ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
      status: {
        value: run.state,
        confidence: run.confidence,
        reason: run.reason,
        source: "harness_hook",
        updatedAt: observedAt,
      },
      observedAt,
    }));
  }

  async stop(request: HarnessStopRequest): Promise<HarnessStopResult> {
    maybeThrow(this.#failures, "stop");
    return {
      runId: request.runId,
      stopped: this.#runs.some((run) => run.id === request.runId),
    };
  }

  snapshot(): { runs: HarnessRunObservation[] } {
    return {
      runs: [...this.#runs],
    };
  }
}
