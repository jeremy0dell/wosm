import type {
  CommandId,
  CommandReceipt,
  SafeError,
  WosmCommand,
  WosmEvent,
  WosmSnapshot,
} from "@wosm/contracts";

export type WosmClientCommandCompletion =
  | {
      status: "succeeded";
      commandId: CommandId;
    }
  | {
      status: "failed";
      commandId: CommandId;
      error: SafeError;
    };

/**
 * App-facing observer API with timeout and safe-error normalization applied.
 * Distinct from protocol's `ObserverClient`, which is the raw socket transport.
 */
export type ObserverService = {
  loadSnapshot(): Promise<WosmSnapshot>;
  subscribeEvents(): AsyncIterable<WosmEvent>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  waitForCommandCompletion(commandId: CommandId): Promise<WosmClientCommandCompletion>;
  reconcile(reason?: string): Promise<WosmSnapshot>;
};

export type ClientNotice = {
  kind: "info" | "success" | "error";
  message: string;
  hint?: string;
  commandId?: string;
  traceId?: string;
  diagnosticId?: string;
};

export type ApplyWosmEventResult = {
  snapshot: WosmSnapshot;
  needsSnapshotRefresh: boolean;
  notices: ClientNotice[];
};

export type WosmClientConnectionState =
  | { state: "idle" }
  | { state: "loading"; since: number }
  | { state: "connected"; since: number }
  | { state: "reconnecting"; since: number; lastError: SafeError }
  | { state: "displayOnly"; since: number; lastError: SafeError }
  | { state: "halted"; since: number; lastError: SafeError };

export type WosmClientRuntimeState = {
  snapshot?: WosmSnapshot;
  connection: WosmClientConnectionState;
  inFlightRefresh: boolean;
};

export type WosmClientRefreshOutcome =
  | { status: "loaded"; snapshot: WosmSnapshot }
  | { status: "connectFailure"; error: SafeError }
  | { status: "failure"; error: SafeError };

/**
 * Bridge callbacks for apps that need per-event and per-refresh side effects
 * (toasts, local-operation reconciliation). Hooks fire synchronously after the
 * runtime swaps its own state and before listeners are notified, and only for
 * runtime-initiated work; the public `refresh()` fires no hooks.
 */
export type WosmClientRuntimeHooks = {
  onEvent?(event: WosmEvent, application: ApplyWosmEventResult | undefined): void;
  onSubscriptionError?(
    error: SafeError,
    info: { isConnectError: boolean; alreadyReported: boolean; willRetry: boolean },
  ): void;
  onRefreshSettled?(outcome: WosmClientRefreshOutcome): void;
};

/**
 * Reconnect delays grow exponentially with jitter from `initialDelayMs`
 * (default 100) up to a hard `maxDelayMs` cap (default 5000), resetting after
 * a successful resubscribe.
 */
export type WosmClientReconnectOptions = {
  initialDelayMs?: number;
  maxDelayMs?: number;
};

export type WosmClientRuntimeOptions = {
  socketPath?: string;
  service?: ObserverService;
  initialSnapshot?: WosmSnapshot;
  requestTimeoutMs?: number;
  commandWaitTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  clientLabel?: string;
  reconnect?: WosmClientReconnectOptions;
  hooks?: WosmClientRuntimeHooks;
};

export type WosmClientRuntime = {
  start(): void;
  stop(): Promise<void>;
  getState(): WosmClientRuntimeState;
  subscribe(listener: () => void): () => void;
  refresh(reason?: string): Promise<void>;
  reconcile(reason?: string): Promise<void>;
  dispatch(command: WosmCommand): Promise<CommandReceipt>;
  waitForCommand(commandId: CommandId): Promise<WosmClientCommandCompletion>;
};
