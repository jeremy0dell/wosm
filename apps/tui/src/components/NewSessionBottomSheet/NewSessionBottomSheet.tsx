import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { type NewSessionFlowState, selectedProject } from "../../flows/newSession.js";
import {
  selectNewSessionHarnessChoices,
  selectNewSessionHarnessOptions,
  selectNewSessionProjectChoices,
} from "../../selectors/selectors.js";
import { EditableTextInput } from "../EditableTextInput/EditableTextInput.js";
import { newSessionBottomSheetLayout } from "./layout.js";

export type NewSessionBottomSheetProps = {
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  columns: number;
  rows: number;
};

export function NewSessionBottomSheet({
  snapshot,
  state,
  columns,
  rows,
}: NewSessionBottomSheetProps) {
  const project = selectedProject(snapshot, state);
  const optionCount = optionCountForState(snapshot, state, project);
  const layout = newSessionBottomSheetLayout({ columns, rows, state, optionCount });
  const contentWidth = Math.max(1, layout.width - 2);

  return (
    <Box
      position="absolute"
      left={layout.left}
      top={layout.top}
      width={layout.width}
      height={layout.height}
      borderStyle="round"
      borderColor="gray"
      flexDirection="column"
      overflow="hidden"
    >
      <Text bold>{` ${titleForState(state)}`}</Text>
      {renderMode(snapshot, state, project, contentWidth)}
    </Box>
  );
}

function renderMode(
  snapshot: WosmSnapshot,
  state: NewSessionFlowState,
  project: ProjectView | undefined,
  contentWidth: number,
) {
  if (state.mode === "pickProject") {
    return <ProjectPicker snapshot={snapshot} width={contentWidth} />;
  }
  if (state.mode === "pickAgent" && project !== undefined) {
    return <AgentPicker snapshot={snapshot} project={project} width={contentWidth} />;
  }
  if (state.mode === "editName") {
    return <EditName state={state} project={project} width={contentWidth} />;
  }
  return <Review snapshot={snapshot} state={state} project={project} width={contentWidth} />;
}

function titleForState(state: NewSessionFlowState): string {
  if (state.mode === "editName") {
    return "Edit Session Name";
  }
  return "New Session";
}

function Review({
  snapshot,
  state,
  project,
  width,
}: {
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  project: ProjectView | undefined;
  width: number;
}) {
  const harness =
    project === undefined ? undefined : selectedHarnessOption(snapshot, project, state);
  return (
    <>
      <BlankLine />
      <LabelValue label="Project" value={project?.label ?? "-"} />
      <LabelValue
        label="Name"
        value={state.branch}
        color={state.nameSource === "generated" ? "gray" : undefined}
      />
      <LabelValue
        label="Agent"
        value={harness === undefined ? state.selectedHarness : `${harness.label} ${harness.status}`}
        color={statusColor(harness?.status)}
      />
      <BlankLine />
      <Text> Enter:create</Text>
      <FooterLine width={width}>{"E:edit name   P:project   A:agent   Esc:cancel"}</FooterLine>
    </>
  );
}

function EditName({
  state,
  project,
  width,
}: {
  state: Extract<NewSessionFlowState, { mode: "editName" }>;
  project: ProjectView | undefined;
  width: number;
}) {
  const hasDraft = state.draftName.value.trim().length > 0;
  return (
    <>
      <BlankLine />
      <LabelValue label="Project" value={project?.label ?? "-"} />
      <LabelValue label="Name" value={<EditNameValue state={state} />} />
      <BlankLine />
      <FooterLine width={width}>
        {hasDraft ? "Enter:use name   Esc:back" : "Enter:use generated name   Esc:back"}
      </FooterLine>
    </>
  );
}

function EditNameValue({ state }: { state: Extract<NewSessionFlowState, { mode: "editName" }> }) {
  return <EditableTextInput {...state.draftName} placeholder={state.branch} />;
}

function ProjectPicker({ snapshot, width }: { snapshot: WosmSnapshot; width: number }) {
  const projects = selectNewSessionProjectChoices(snapshot);
  return (
    <>
      <BlankLine />
      {projects.map((choice) => (
        <PickerLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.health.status}
          color={statusColor(choice.value.health.status)}
        />
      ))}
      <BlankLine />
      <FooterLine width={width}>1-9/a-z:select Esc:back</FooterLine>
    </>
  );
}

function AgentPicker({
  snapshot,
  project,
  width,
}: {
  snapshot: WosmSnapshot;
  project: ProjectView;
  width: number;
}) {
  const options = selectNewSessionHarnessChoices(snapshot, project);
  return (
    <>
      <BlankLine />
      {options.map((choice) => (
        <PickerLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.status}
          color={statusColor(choice.value.status)}
        />
      ))}
      <BlankLine />
      <FooterLine width={width}>1-9/a-z:select Esc:back</FooterLine>
    </>
  );
}

function LabelValue({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: "red" | "yellow" | "gray" | undefined;
}) {
  return (
    <Box>
      <Text>{` ${label.padEnd(10)}`}</Text>
      {typeof value === "string" ? (
        color === undefined ? (
          <Text>{value}</Text>
        ) : (
          <Text color={color}>{value}</Text>
        )
      ) : (
        value
      )}
    </Box>
  );
}

function PickerLine({
  choiceKey,
  label,
  detail,
  color,
}: {
  choiceKey: string;
  label: string;
  detail: string;
  color?: "red" | "yellow" | "gray" | undefined;
}) {
  return (
    <Box>
      <Text>{` ${choiceKey} `}</Text>
      <Text>{label}</Text>
      <Text> </Text>
      {color === undefined ? <Text>{detail}</Text> : <Text color={color}>{detail}</Text>}
    </Box>
  );
}

function BlankLine() {
  return <Box height={1} />;
}

function FooterLine({ children, width }: { children: string; width: number }) {
  const text = ` ${children}`.padEnd(width).slice(0, width);
  return <Text>{text}</Text>;
}

function selectedHarnessOption(
  snapshot: WosmSnapshot,
  project: ProjectView,
  state: NewSessionFlowState,
) {
  return selectNewSessionHarnessOptions(snapshot, project).find(
    (option) => option.id === state.selectedHarness,
  );
}

function optionCountForState(
  snapshot: WosmSnapshot,
  state: NewSessionFlowState,
  project: ProjectView | undefined,
): number {
  if (state.mode === "pickProject") {
    return selectNewSessionProjectChoices(snapshot).length;
  }
  if (state.mode === "pickAgent" && project !== undefined) {
    return selectNewSessionHarnessChoices(snapshot, project).length;
  }
  return 0;
}

function statusColor(status: string | undefined): "red" | "yellow" | "gray" | undefined {
  if (status === "unavailable") {
    return "red";
  }
  if (status === "degraded") {
    return "yellow";
  }
  return undefined;
}
