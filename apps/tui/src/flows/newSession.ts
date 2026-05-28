import type {
  ProjectId,
  ProjectView,
  ProviderHealth,
  ProviderId,
  SafeError,
  WosmSnapshot,
} from "@wosm/contracts";
import { stableName } from "@wosm/runtime";
import {
  createEditableTextInputState,
  type EditableTextEditAction,
  type EditableTextInputState,
  editableTextInputIntentForInput,
  transitionEditableTextInput,
} from "../components/EditableTextInput/editing.js";
import {
  backWizardStep,
  createStepWizardState,
  enterWizardStep,
  resetWizardStep,
  type StepWizardState,
} from "./stepWizard.js";

export type NewSessionNameSource = "generated" | "custom";
export type NewSessionStep = "review" | "editName" | "pickProject" | "pickAgent";

type NewSessionBaseState = StepWizardState<NewSessionStep> & {
  selectedProjectId: ProjectId;
  selectedHarness: ProviderId;
  branch: string;
  nameSource: NewSessionNameSource;
};

export type NewSessionReviewState = NewSessionBaseState & {
  mode: "review";
};

export type NewSessionEditNameState = NewSessionBaseState & {
  mode: "editName";
  draftName: EditableTextInputState;
};

export type NewSessionPickProjectState = NewSessionBaseState & {
  mode: "pickProject";
  cursor: number;
};

export type NewSessionPickAgentState = NewSessionBaseState & {
  mode: "pickAgent";
  cursor: number;
};

export type NewSessionFlowState =
  | NewSessionReviewState
  | NewSessionEditNameState
  | NewSessionPickProjectState
  | NewSessionPickAgentState;

export type NewSessionFlowAction =
  | { type: "editName" }
  | { type: "editNameInput"; action: EditableTextEditAction }
  | { type: "commitName" }
  | { type: "pickProject" }
  | { type: "pickAgent" }
  | { type: "moveCursor"; delta: number }
  | { type: "commitProject"; token: string }
  | { type: "chooseProject"; index: number; token: string }
  | { type: "commitAgent" }
  | { type: "chooseAgent"; index: number }
  | { type: "cancel" };

export type NewSessionInputKey = {
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
};

export type NewSessionInput = {
  input: string;
  key: NewSessionInputKey;
  token: string;
};

export type NewSessionInputIntent =
  | {
      type: "transition";
      action: NewSessionFlowAction;
    }
  | {
      type: "submit";
    }
  | {
      type: "none";
    };

export type NewSessionHarnessOption = {
  id: ProviderId;
  label: string;
  status: ProviderHealth["status"];
  isDefault: boolean;
  createBlocked: boolean;
  health?: ProviderHealth;
};

export type NewSessionCreateValidation =
  | {
      ok: true;
      project: ProjectView;
      branch: string;
      harnessProvider: ProviderId;
    }
  | {
      ok: false;
      error: SafeError;
    };

export function createNewSessionFlow(
  snapshot: WosmSnapshot,
  token: string,
): NewSessionReviewState | undefined {
  const project = snapshot.projects[0];
  if (project === undefined) {
    return undefined;
  }
  return {
    ...createStepWizardState("review"),
    selectedProjectId: project.id,
    selectedHarness: project.defaults.harness,
    branch: generatedSessionBranch(project.id, token),
    nameSource: "generated",
  };
}

export function transitionNewSessionFlow(
  state: NewSessionFlowState,
  snapshot: WosmSnapshot,
  action: NewSessionFlowAction,
): NewSessionFlowState | undefined {
  switch (action.type) {
    case "cancel":
      return cancelNewSessionStep(state);
    case "editName":
      return {
        ...enterWizardStep(baseState(state), "editName"),
        draftName: createEditableTextInputState(),
      } satisfies NewSessionEditNameState;
    case "editNameInput":
      return state.mode === "editName"
        ? {
            ...state,
            draftName: transitionEditableTextInput(state.draftName, action.action),
          }
        : state;
    case "commitName":
      return state.mode === "editName" ? commitEditedName(state) : state;
    case "pickProject":
      return {
        ...enterWizardStep(baseState(state), "pickProject"),
        cursor: selectedProjectIndex(snapshot, state.selectedProjectId),
      } satisfies NewSessionPickProjectState;
    case "moveCursor":
      return moveCurrentCursor(state, snapshot, action.delta);
    case "commitProject":
      return state.mode === "pickProject"
        ? selectProjectAtIndex(state, snapshot, state.cursor, action.token)
        : state;
    case "chooseProject":
      return state.mode === "pickProject"
        ? selectProjectAtIndex(state, snapshot, action.index, action.token)
        : state;
    case "pickAgent":
      return openAgentPicker(state, snapshot);
    case "commitAgent":
      return state.mode === "pickAgent" ? selectAgentAtIndex(state, snapshot, state.cursor) : state;
    case "chooseAgent":
      return state.mode === "pickAgent" ? selectAgentAtIndex(state, snapshot, action.index) : state;
  }
}

export function newSessionIntentForInput(
  state: NewSessionFlowState,
  input: NewSessionInput,
): NewSessionInputIntent {
  if (input.key.escape === true) {
    return transitionIntent({ type: "cancel" });
  }
  switch (state.mode) {
    case "review":
      return reviewInputIntent(input);
    case "editName":
      return editNameInputIntent(input);
    case "pickProject":
      return pickerInputIntent(input, {
        commit: { type: "commitProject", token: input.token },
        choose: (index) => ({ type: "chooseProject", index, token: input.token }),
      });
    case "pickAgent":
      return pickerInputIntent(input, {
        commit: { type: "commitAgent" },
        choose: (index) => ({ type: "chooseAgent", index }),
      });
  }
}

export function selectedProject(
  snapshot: WosmSnapshot,
  state: NewSessionFlowState,
): ProjectView | undefined {
  return (
    snapshot.projects.find((project) => project.id === state.selectedProjectId) ??
    snapshot.projects[0]
  );
}

export function harnessOptions(
  snapshot: WosmSnapshot,
  project: ProjectView,
): NewSessionHarnessOption[] {
  const configured = configuredHarnesses(snapshot, project);
  const labels = new Map(configured.map((harness) => [harness.id, harness.label]));
  const orderedIds = [project.defaults.harness, ...configured.map((harness) => harness.id)];
  const seen = new Set<string>();
  const options: NewSessionHarnessOption[] = [];

  for (const id of orderedIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const health = snapshot.providerHealth[id];
    const option: NewSessionHarnessOption = {
      id,
      label: labels.get(id) ?? id,
      status: health?.status ?? "unknown",
      isDefault: id === project.defaults.harness,
      createBlocked: health?.status === "unavailable",
    };
    if (health !== undefined) {
      option.health = health;
    }
    options.push(option);
  }

  return options;
}

export function validateNewSessionCreate(
  snapshot: WosmSnapshot,
  state: NewSessionFlowState,
): NewSessionCreateValidation {
  const project = selectedProject(snapshot, state);
  if (project === undefined) {
    return {
      ok: false,
      error: {
        tag: "CommandValidationError",
        code: "PROJECT_NOT_CONFIGURED",
        message: "No project is configured for a new session.",
        hint: "Add a project to config.toml and run wosm reconcile.",
      },
    };
  }

  if (project.health.status === "unavailable") {
    return {
      ok: false,
      error:
        project.health.lastError ??
        ({
          tag: "ProviderUnavailableError",
          code: "WORKTREE_PROVIDER_UNAVAILABLE",
          message: "The worktree provider is unavailable.",
          hint: "Run wosm doctor for provider diagnostics.",
          provider: project.health.providerId,
        } satisfies SafeError),
    };
  }

  const harness = harnessOptions(snapshot, project).find(
    (option) => option.id === state.selectedHarness,
  );
  if (harness?.status === "unavailable") {
    return {
      ok: false,
      error:
        harness.health?.lastError ??
        ({
          tag: "ProviderUnavailableError",
          code: "HARNESS_PROVIDER_UNAVAILABLE",
          message: `The harness provider ${harness.id} is unavailable.`,
          hint: "Run wosm doctor for provider diagnostics.",
          provider: harness.id,
        } satisfies SafeError),
    };
  }

  return {
    ok: true,
    project,
    branch: state.branch,
    harnessProvider: state.selectedHarness,
  };
}

export function generatedSessionBranch(projectId: ProjectId, token: string): string {
  return stableName({
    profile: "path-segment",
    display: [projectId, token],
    unique: [projectId, token],
  });
}

function configuredHarnesses(snapshot: WosmSnapshot, project: ProjectView) {
  if (snapshot.harnesses !== undefined) {
    return snapshot.harnesses;
  }

  const healthHarnesses = Object.values(snapshot.providerHealth)
    .filter((health) => health.providerType === "harness")
    .map((health) => ({
      id: health.providerId,
      label: health.providerId,
    }));

  return [{ id: project.defaults.harness, label: project.defaults.harness }, ...healthHarnesses];
}

function reviewInputIntent(input: NewSessionInput): NewSessionInputIntent {
  if (isReturn(input)) {
    return { type: "submit" };
  }
  return reviewKeyIntents[input.input] ?? { type: "none" };
}

const reviewKeyIntents: Record<string, NewSessionInputIntent> = {
  e: transitionIntent({ type: "editName" }),
  E: transitionIntent({ type: "editName" }),
  p: transitionIntent({ type: "pickProject" }),
  P: transitionIntent({ type: "pickProject" }),
  a: transitionIntent({ type: "pickAgent" }),
  A: transitionIntent({ type: "pickAgent" }),
};

function editNameInputIntent(input: NewSessionInput): NewSessionInputIntent {
  if (isReturn(input)) {
    return transitionIntent({ type: "commitName" });
  }
  const intent = editableTextInputIntentForInput(input);
  return intent.type === "edit"
    ? transitionIntent({ type: "editNameInput", action: intent.action })
    : { type: "none" };
}

function pickerInputIntent(
  input: NewSessionInput,
  actions: {
    commit: NewSessionFlowAction;
    choose(index: number): NewSessionFlowAction;
  },
): NewSessionInputIntent {
  if (input.key.downArrow === true || input.input === "j") {
    return transitionIntent({ type: "moveCursor", delta: 1 });
  }
  if (input.key.upArrow === true || input.input === "k") {
    return transitionIntent({ type: "moveCursor", delta: -1 });
  }
  if (isReturn(input)) {
    return transitionIntent(actions.commit);
  }
  const directIndex = /^[1-9]$/.test(input.input) ? Number(input.input) - 1 : undefined;
  return directIndex === undefined
    ? { type: "none" }
    : transitionIntent(actions.choose(directIndex));
}

function transitionIntent(action: NewSessionFlowAction): NewSessionInputIntent {
  return {
    type: "transition",
    action,
  };
}

function isReturn(input: NewSessionInput): boolean {
  return input.key.return === true || input.input === "\r" || input.input === "\n";
}

function openAgentPicker(
  state: NewSessionFlowState,
  snapshot: WosmSnapshot,
): NewSessionPickAgentState {
  const project = selectedProject(snapshot, state);
  const options = project === undefined ? [] : harnessOptions(snapshot, project);
  return {
    ...enterWizardStep(baseState(state), "pickAgent"),
    cursor: selectedHarnessIndex(options, state.selectedHarness),
  } satisfies NewSessionPickAgentState;
}

function commitEditedName(state: NewSessionEditNameState): NewSessionReviewState {
  const branch = state.draftName.value.trim();
  if (branch.length === 0) {
    return toReviewState(state);
  }
  return {
    ...resetWizardStep(baseState(state), "review"),
    selectedProjectId: state.selectedProjectId,
    selectedHarness: state.selectedHarness,
    branch,
    nameSource: "custom",
  };
}

function selectProjectAtIndex(
  state: NewSessionPickProjectState,
  snapshot: WosmSnapshot,
  index: number,
  token: string,
): NewSessionPickProjectState | NewSessionReviewState {
  const project = snapshot.projects[index];
  if (project === undefined) {
    return state;
  }
  return {
    ...resetWizardStep(baseState(state), "review"),
    selectedProjectId: project.id,
    selectedHarness: project.defaults.harness,
    branch:
      state.nameSource === "generated" ? generatedSessionBranch(project.id, token) : state.branch,
    nameSource: state.nameSource,
  };
}

function moveCurrentCursor(
  state: NewSessionFlowState,
  snapshot: WosmSnapshot,
  delta: number,
): NewSessionFlowState {
  if (state.mode === "pickProject") {
    return {
      ...state,
      cursor: moveCursor(state.cursor, snapshot.projects.length, delta),
    };
  }
  if (state.mode !== "pickAgent") {
    return state;
  }
  const project = selectedProject(snapshot, state);
  const options = project === undefined ? [] : harnessOptions(snapshot, project);
  return {
    ...state,
    cursor: moveCursor(state.cursor, options.length, delta),
  };
}

function selectAgentAtIndex(
  state: NewSessionPickAgentState,
  snapshot: WosmSnapshot,
  index: number,
): NewSessionPickAgentState | NewSessionReviewState {
  const project = selectedProject(snapshot, state);
  const options = project === undefined ? [] : harnessOptions(snapshot, project);
  const option = options[index];
  if (option === undefined) {
    return state;
  }
  return {
    ...resetWizardStep(baseState(state), "review"),
    selectedProjectId: state.selectedProjectId,
    selectedHarness: option.id,
    branch: state.branch,
    nameSource: state.nameSource,
  };
}

function selectedProjectIndex(snapshot: WosmSnapshot, selectedProjectId: ProjectId): number {
  const index = snapshot.projects.findIndex((project) => project.id === selectedProjectId);
  return index === -1 ? 0 : index;
}

function selectedHarnessIndex(
  options: readonly NewSessionHarnessOption[],
  selectedHarness: ProviderId,
): number {
  const index = options.findIndex((option) => option.id === selectedHarness);
  return index === -1 ? 0 : index;
}

function moveCursor(cursor: number, count: number, delta: number): number {
  if (count <= 0) {
    return 0;
  }
  return (cursor + delta + count) % count;
}

function cancelNewSessionStep(state: NewSessionFlowState): NewSessionReviewState | undefined {
  const previous = backWizardStep(baseState(state));
  if (previous === undefined) {
    return undefined;
  }
  return toReviewState(previous);
}

function toReviewState(state: NewSessionBaseState): NewSessionReviewState {
  return {
    ...resetWizardStep(baseState(state), "review"),
  };
}

function baseState(state: NewSessionBaseState): NewSessionBaseState {
  return {
    mode: state.mode,
    stepHistory: state.stepHistory,
    selectedProjectId: state.selectedProjectId,
    selectedHarness: state.selectedHarness,
    branch: state.branch,
    nameSource: state.nameSource,
  };
}
