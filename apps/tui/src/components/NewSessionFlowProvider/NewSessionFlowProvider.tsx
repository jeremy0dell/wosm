import { randomInt } from "node:crypto";
import type { WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import { useInput } from "ink";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildCreateSessionCommand } from "../../actions.js";
import {
  createNewSessionFlow,
  type NewSessionFlowState,
  newSessionIntentForInput,
  transitionNewSessionFlow,
  validateNewSessionCreate,
} from "../../flows/newSession.js";
import type { ObserverDashboardState } from "../../hooks/useObserverDashboard.js";
import {
  addPendingCreate,
  applyEventToUiOrchestration,
  applySnapshotToUiOrchestration,
  attachPendingCreateCommand,
  createInitialUiOrchestrationState,
  type PendingCreateSession,
  removePendingCreate,
  type UiOrchestrationState,
} from "../../orchestration/uiOrchestration.js";
import { safeErrorToToast } from "../../services/errors.js";

export type NewSessionOverlayState =
  | {
      type: "new-session";
      state: NewSessionFlowState;
    }
  | undefined;

export type NewSessionFlowContextValue = {
  isActive: boolean;
  optimisticCreates: readonly PendingCreateSession[];
  overlay: NewSessionOverlayState;
  open(): void;
};

const NewSessionFlowContext = createContext<NewSessionFlowContextValue | undefined>(undefined);

export function NewSessionFlowProvider({
  dashboard,
  snapshot,
  children,
}: {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  children: ReactNode;
}) {
  const pendingCreateCounterRef = useRef(0);
  const [newSessionState, setNewSessionState] = useState<NewSessionFlowState | undefined>();
  const [orchestrationState, setOrchestrationState] = useState<UiOrchestrationState>(
    createInitialUiOrchestrationState,
  );

  useEffect(() => {
    setOrchestrationState((current) => applySnapshotToUiOrchestration(current, snapshot));
  }, [snapshot]);

  const open = useCallback(() => {
    const state = createNewSessionFlow(snapshot, createSessionNameToken());
    if (state === undefined) {
      dashboard.addToast(
        safeErrorToToast({
          tag: "CommandValidationError",
          code: "PROJECT_NOT_CONFIGURED",
          message: "No project is configured for a new session.",
          hint: "Add a project to config.toml and run wosm reconcile.",
        }),
      );
      return;
    }
    setNewSessionState(state);
  }, [dashboard, snapshot]);

  useInput(
    (input, key) => {
      if (newSessionState === undefined) {
        setNewSessionState(undefined);
        return;
      }

      const intent = newSessionIntentForInput(newSessionState, {
        input,
        key,
        token: createSessionNameToken(),
      });

      if (intent.type === "none") {
        return;
      }
      if (intent.type === "submit") {
        submitNewSessionFlow({
          dashboard,
          snapshot,
          state: newSessionState,
          setNewSessionState,
          setOrchestrationState,
          pendingCreateCounterRef,
        });
        return;
      }
      setNewSessionState((current) =>
        current === undefined
          ? undefined
          : transitionNewSessionFlow(current, snapshot, intent.action),
      );
    },
    { isActive: newSessionState !== undefined },
  );

  const value = useMemo<NewSessionFlowContextValue>(
    () => ({
      isActive: newSessionState !== undefined,
      optimisticCreates: orchestrationState.pendingCreates,
      overlay:
        newSessionState === undefined
          ? undefined
          : {
              type: "new-session",
              state: newSessionState,
            },
      open,
    }),
    [newSessionState, open, orchestrationState.pendingCreates],
  );

  return (
    <>
      {dashboard.lastEvent === undefined ? null : (
        <PendingCreateEventSync
          event={dashboard.lastEvent}
          setOrchestrationState={setOrchestrationState}
        />
      )}
      <NewSessionFlowContext.Provider value={value}>{children}</NewSessionFlowContext.Provider>
    </>
  );
}

export function useNewSessionFlow(): NewSessionFlowContextValue {
  const context = useContext(NewSessionFlowContext);
  if (context === undefined) {
    throw new Error("useNewSessionFlow must be used inside NewSessionFlowProvider.");
  }
  return context;
}

function PendingCreateEventSync({
  event,
  setOrchestrationState,
}: {
  event: WosmEvent;
  setOrchestrationState: Dispatch<SetStateAction<UiOrchestrationState>>;
}) {
  useEffect(() => {
    setOrchestrationState((current) => applyEventToUiOrchestration(current, event));
  }, [event, setOrchestrationState]);

  return null;
}

function submitNewSessionFlow(input: {
  dashboard: ObserverDashboardState;
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  setNewSessionState(next: NewSessionFlowState | undefined): void;
  setOrchestrationState(next: (current: UiOrchestrationState) => UiOrchestrationState): void;
  pendingCreateCounterRef: { current: number };
}): void {
  const validation = validateNewSessionCreate(input.snapshot, input.state);
  if (!validation.ok) {
    input.dashboard.addToast(safeErrorToToast(validation.error));
    input.setNewSessionState(undefined);
    return;
  }

  const pendingId = nextPendingCreateId(input.pendingCreateCounterRef);
  const branch = validation.branch.trim();
  const command = buildCreateSessionCommand({
    project: validation.project,
    branch,
    harnessProvider: validation.harnessProvider,
  });
  input.setNewSessionState(undefined);
  input.setOrchestrationState((current) =>
    addPendingCreate(current, {
      id: pendingId,
      projectId: validation.project.id,
      branch,
      harnessProvider: validation.harnessProvider,
    }),
  );
  void dispatchCreateSessionWithOptimism({
    dashboard: input.dashboard,
    command,
    pendingId,
    setOrchestrationState: input.setOrchestrationState,
  });
}

async function dispatchCreateSessionWithOptimism(input: {
  dashboard: ObserverDashboardState;
  command: WosmCommand;
  pendingId: string;
  setOrchestrationState(next: (current: UiOrchestrationState) => UiOrchestrationState): void;
}): Promise<void> {
  const receipt = await input.dashboard.dispatchCommandWithReceipt(input.command);
  if (receipt?.accepted === true) {
    input.setOrchestrationState((current) =>
      attachPendingCreateCommand(current, input.pendingId, receipt.commandId),
    );
    return;
  }
  input.setOrchestrationState((current) => removePendingCreate(current, input.pendingId));
}

function nextPendingCreateId(ref: { current: number }): string {
  ref.current += 1;
  return `pending_create_${ref.current}`;
}

function createSessionNameToken(): string {
  return randomInt(36 ** 6)
    .toString(36)
    .padStart(6, "0");
}
