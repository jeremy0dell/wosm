// OpenTUI port of apps/tui's NewSessionBottomSheet (review / editName /
// pickProject / pickAgent). Picker lines are click targets dispatching their
// slot key through the wosm mouse router.
import type { ProjectView, WosmSnapshot } from "@wosm/contracts";
import { type NewSessionFlowState, selectedProject } from "../../ported/flows/newSession.js";
import {
  bottomSheetContentWidth,
  newSessionContentRowCount,
} from "../../ported/components/BottomSheetFrame/layout.js";
import {
  selectNewSessionHarnessChoices,
  selectNewSessionHarnessOptions,
  selectNewSessionProjectChoices,
} from "../../ported/selectors/selectors.js";
import { EditableTextInputView } from "../EditableTextInputView.js";
import { WOSM_COLORS } from "../theme.js";
import { useWosmMouse, wosmMouseProps } from "../wosmMouseContext.js";
import { BottomSheetFrameView } from "./BottomSheetFrameView.js";
import { SheetFooter, SheetLabelValue, SheetLine, spaces } from "./parts.js";

export type NewSessionSheetViewProps = {
  snapshot: WosmSnapshot;
  state: NewSessionFlowState;
  columns: number;
  rows: number;
};

export function NewSessionSheetView({ snapshot, state, columns, rows }: NewSessionSheetViewProps) {
  const project = selectedProject(snapshot, state);
  const optionCount = optionCountForState(snapshot, state, project);
  const contentWidth = bottomSheetContentWidth(columns);

  return (
    <BottomSheetFrameView
      columns={columns}
      rows={rows}
      title={titleForState(state)}
      contentRows={newSessionContentRowCount(state, optionCount)}
    >
      {renderMode(snapshot, state, project, contentWidth)}
    </BottomSheetFrameView>
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
      <SheetLine width={width}> </SheetLine>
      <SheetLabelValue width={width} label="Project" labelWidth={10} value={project?.label ?? "-"} />
      <SheetLabelValue
        width={width}
        label="Name"
        labelWidth={10}
        value={state.branch}
        {...(state.nameSource === "generated" ? { valueColor: WOSM_COLORS.gray } : {})}
      />
      <SheetLabelValue
        width={width}
        label="Agent"
        labelWidth={10}
        value={harness === undefined ? state.selectedHarness : `${harness.label} ${harness.status}`}
        {...colorProp(statusColor(harness?.status))}
      />
      <SheetLine width={width}> </SheetLine>
      <SheetFooter width={width}>{"Enter:create N:name P:project A:agent Esc:cancel"}</SheetFooter>
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
  const labelText = ` ${"Name".padEnd(10)} `;
  const inputLength =
    (state.draftName.value.length === 0 ? state.branch.length : state.draftName.value.length) + 1;
  const padding = spaces(Math.max(0, width - labelText.length - inputLength));
  return (
    <>
      <SheetLine width={width}> </SheetLine>
      <SheetLabelValue width={width} label="Project" labelWidth={10} value={project?.label ?? "-"} />
      <SheetLabelValue
        width={width}
        label="Name"
        labelWidth={10}
        value={
          <span>
            <EditableTextInputView {...state.draftName} placeholder={state.branch} />
            {padding}
          </span>
        }
      />
      <SheetLine width={width}> </SheetLine>
      <SheetFooter width={width}>{"Enter:save   Esc:back"}</SheetFooter>
    </>
  );
}

function ProjectPicker({ snapshot, width }: { snapshot: WosmSnapshot; width: number }) {
  const projects = selectNewSessionProjectChoices(snapshot);
  return (
    <>
      <SheetLine width={width}> </SheetLine>
      {projects.map((choice) => (
        <ChoiceLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.health.status}
          color={statusColor(choice.value.health.status)}
          width={width}
        />
      ))}
      <SheetLine width={width}> </SheetLine>
      <SheetFooter width={width}>{"1-9/a-z:select   Esc:back"}</SheetFooter>
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
      <SheetLine width={width}> </SheetLine>
      {options.map((choice) => (
        <ChoiceLine
          key={choice.value.id}
          choiceKey={choice.key}
          label={choice.value.label}
          detail={choice.value.status}
          color={statusColor(choice.value.status)}
          width={width}
        />
      ))}
      <SheetLine width={width}> </SheetLine>
      <SheetFooter width={width}>{"1-9/a-z:select   Esc:back"}</SheetFooter>
    </>
  );
}

/** Slot-keyed picker line; a click selects exactly what the key would. */
function ChoiceLine({
  choiceKey,
  label,
  detail,
  color,
  width,
}: {
  choiceKey: string;
  label: string;
  detail: string;
  color?: string | undefined;
  width: number;
}) {
  const dispatch = useWosmMouse();
  const prefix = ` ${choiceKey} `;
  const detailPrefix = `${label} `;
  const detailWidth = Math.max(0, width - prefix.length - detailPrefix.length);
  const visibleDetail = detail.slice(0, detailWidth);
  const padding = spaces(Math.max(0, detailWidth - visibleDetail.length));
  return (
    <text
      fg={WOSM_COLORS.foreground}
      {...wosmMouseProps(dispatch, { kind: "sheetChoice", choiceKey })}
    >
      {prefix}
      {detailPrefix}
      <span {...(color === undefined ? {} : { fg: color })}>{visibleDetail}</span>
      {padding}
    </text>
  );
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

function statusColor(status: string | undefined): string | undefined {
  if (status === "unavailable") {
    return WOSM_COLORS.red;
  }
  if (status === "degraded") {
    return WOSM_COLORS.yellow;
  }
  return undefined;
}

function colorProp(color: string | undefined): { valueColor?: string } {
  return color === undefined ? {} : { valueColor: color };
}
