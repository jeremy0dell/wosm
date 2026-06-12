import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import {
  bottomSheetContentWidth,
  type NewSessionFlowState,
  newSessionContentRowCount,
  selectedProject,
  selectNewSessionHarnessChoices,
  selectNewSessionHarnessOptions,
  selectNewSessionProjectChoices,
} from "@wosm/dashboard-core";
import { Box, Text } from "ink";
import { BottomSheetFrame } from "../BottomSheetFrame/BottomSheetFrame.js";
import { EditableTextInput } from "../EditableTextInput/EditableTextInput.js";

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
  const contentWidth = bottomSheetContentWidth(columns);

  return (
    <BottomSheetFrame
      columns={columns}
      rows={rows}
      title={titleForState(state)}
      contentRows={newSessionContentRowCount(state, optionCount)}
    >
      {renderMode(snapshot, state, project, contentWidth)}
    </BottomSheetFrame>
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
  switch (state.mode) {
    case "review":
      return "Create Session";
    case "editName":
      return "Set Session Name";
    case "pickProject":
      return "Choose Project";
    case "pickAgent":
      return "Choose Agent";
  }
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
      <BlankLine width={width} />
      <LabelValue label="Project" value={project?.label ?? "-"} width={width} />
      <LabelValue
        label="Name"
        value={state.branch}
        color={state.nameSource === "generated" ? "gray" : undefined}
        width={width}
      />
      <LabelValue
        label="Agent"
        value={harness === undefined ? state.selectedHarness : `${harness.label} ${harness.status}`}
        color={statusColor(harness?.status)}
        width={width}
      />
      <BlankLine width={width} />
      <FooterLine width={width}>{"Enter:create N:name P:project A:agent Esc:cancel"}</FooterLine>
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
  return (
    <>
      <BlankLine width={width} />
      <LabelValue label="Project" value={project?.label ?? "-"} width={width} />
      <EditableNameLine state={state} width={width} />
      <BlankLine width={width} />
      <FooterLine width={width}>{"Enter:save   Esc:back"}</FooterLine>
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
      <BlankLine width={width} />
      {projects.map((choice) => (
        <PickerLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.health.status}
          color={statusColor(choice.value.health.status)}
          width={width}
        />
      ))}
      <BlankLine width={width} />
      <FooterLine width={width}>{"1-9/a-z:select   Esc:back"}</FooterLine>
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
      <BlankLine width={width} />
      {options.map((choice) => (
        <PickerLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.status}
          color={statusColor(choice.value.status)}
          width={width}
        />
      ))}
      <BlankLine width={width} />
      <FooterLine width={width}>{"1-9/a-z:select   Esc:back"}</FooterLine>
    </>
  );
}

function LabelValue({
  label,
  value,
  color,
  width,
}: {
  label: string;
  value: string;
  color?: "red" | "yellow" | "gray" | undefined;
  width: number;
}) {
  const labelText = ` ${label.padEnd(10)}`;
  const valueWidth = Math.max(0, width - labelText.length);
  const visibleValue = value.slice(0, valueWidth);
  const padding = spaces(Math.max(0, valueWidth - visibleValue.length));
  return (
    <Box>
      <Text>{labelText}</Text>
      {color === undefined ? (
        <Text>{visibleValue}</Text>
      ) : (
        <Text color={color}>{visibleValue}</Text>
      )}
      <Text>{padding}</Text>
    </Box>
  );
}

function EditableNameLine({
  state,
  width,
}: {
  state: Extract<NewSessionFlowState, { mode: "editName" }>;
  width: number;
}) {
  const labelText = ` ${"Name".padEnd(10)}`;
  const inputLength =
    (state.draftName.value.length === 0 ? state.branch.length : state.draftName.value.length) + 1;
  const padding = spaces(Math.max(0, width - labelText.length - inputLength));
  return (
    <Box>
      <Text>{labelText}</Text>
      <EditNameValue state={state} />
      <Text>{padding}</Text>
    </Box>
  );
}

function PickerLine({
  choiceKey,
  label,
  detail,
  color,
  width,
}: {
  choiceKey: string;
  label: string;
  detail: string;
  color?: "red" | "yellow" | "gray" | undefined;
  width: number;
}) {
  const prefix = ` ${choiceKey} `;
  const detailPrefix = `${label} `;
  const detailWidth = Math.max(0, width - prefix.length - detailPrefix.length);
  const visibleDetail = detail.slice(0, detailWidth);
  const padding = spaces(Math.max(0, detailWidth - visibleDetail.length));
  return (
    <Box>
      <Text>{prefix}</Text>
      <Text>{detailPrefix}</Text>
      {color === undefined ? (
        <Text>{visibleDetail}</Text>
      ) : (
        <Text color={color}>{visibleDetail}</Text>
      )}
      <Text>{padding}</Text>
    </Box>
  );
}

function BlankLine({ width }: { width: number }) {
  return <Text>{spaces(width)}</Text>;
}

function FooterLine({ children, width }: { children: string; width: number }) {
  return <Text>{fitLine(` ${children}`, width)}</Text>;
}

function fitLine(value: string, width: number): string {
  return value.padEnd(width).slice(0, width);
}

function spaces(width: number): string {
  return " ".repeat(Math.max(0, width));
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
