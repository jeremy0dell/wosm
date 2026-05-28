import { buildCreateSessionCommand } from "../actions.js";
import {
  createNewSessionFlow,
  createNewSessionNameToken,
  newSessionIntentForInput,
  transitionNewSessionFlow,
  validateNewSessionCreate,
} from "../flows/newSession.js";
import { safeErrorToToast } from "../services/errors.js";
import type { DashboardInputContext } from "./types.js";

export function openNewSessionFlow(context: DashboardInputContext): void {
  if (context.snapshot === undefined) {
    return;
  }
  const state = createNewSessionFlow(context.snapshot, createNewSessionNameToken());
  if (state === undefined) {
    context.dashboard.addToast(
      safeErrorToToast({
        tag: "CommandValidationError",
        code: "PROJECT_NOT_CONFIGURED",
        message: "No project is configured for a new session.",
        hint: "Add a project to config.toml and run wosm reconcile.",
      }),
    );
    return;
  }
  context.setNewSessionState(state);
}

export function handleNewSessionInput(context: DashboardInputContext): void {
  const state = context.newSessionState;
  if (state === undefined) {
    return;
  }
  if (context.snapshot === undefined) {
    context.setNewSessionState(undefined);
    return;
  }

  const intent = newSessionIntentForInput(state, {
    input: context.event.input,
    key: context.event.key,
    token: createNewSessionNameToken(),
  });

  if (intent.type === "none") {
    return;
  }

  if (intent.type === "submit") {
    submitNewSessionFlow(context);
    return;
  }

  context.setNewSessionState(transitionNewSessionFlow(state, context.snapshot, intent.action));
}

function submitNewSessionFlow(context: DashboardInputContext): void {
  const state = context.newSessionState;
  if (state === undefined || context.snapshot === undefined) {
    context.setNewSessionState(undefined);
    return;
  }

  const validation = validateNewSessionCreate(context.snapshot, state);
  context.setNewSessionState(undefined);
  if (!validation.ok) {
    context.dashboard.addToast(safeErrorToToast(validation.error));
    return;
  }

  const branch = validation.branch.trim();
  void context.dashboard.dispatchCommand(
    buildCreateSessionCommand({
      project: validation.project,
      branch,
      harnessProvider: validation.harnessProvider,
    }),
  );
}
