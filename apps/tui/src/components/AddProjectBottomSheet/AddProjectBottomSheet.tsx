import { addProjectRows } from "../../flows/addProject/rows.js";
import type { AddProjectFlowState } from "../../flows/addProject/types.js";
import { BottomSheetFrame } from "../BottomSheetFrame/BottomSheetFrame.js";
import { bottomSheetContentWidth } from "../BottomSheetFrame/layout.js";
import { EditableTextInput } from "../EditableTextInput/EditableTextInput.js";
import {
  Fill,
  Footer,
  LabelValue,
  Line,
  MessageLine,
  MetaLine,
  PickerLine,
  ProgressFooter,
  SectionLine,
} from "./parts.js";

export type AddProjectBottomSheetProps = {
  state: AddProjectFlowState;
  columns: number;
  rows: number;
};

export function AddProjectBottomSheet({ state, columns, rows }: AddProjectBottomSheetProps) {
  const targetHeight = fixedSheetHeight(rows);
  const contentWidth = bottomSheetContentWidth(columns);
  return (
    <BottomSheetFrame
      columns={columns}
      rows={rows}
      title={titleForState(state)}
      contentRows={Math.max(1, targetHeight - 2)}
      minHeight={targetHeight}
    >
      {renderState(state, contentWidth, Math.max(1, targetHeight - 3))}
    </BottomSheetFrame>
  );
}

function renderState(state: AddProjectFlowState, width: number, contentRows: number) {
  if (state.mode === "start") {
    return <StartChoices state={state} width={width} contentRows={contentRows} />;
  }
  if (state.mode === "choose") {
    return <FolderPicker state={state} width={width} contentRows={contentRows} />;
  }
  if (state.mode === "review") {
    return <Review state={state} width={width} />;
  }
  if (state.mode === "success") {
    return <Success state={state} width={width} />;
  }
  return <Failure state={state} width={width} contentRows={contentRows} />;
}

function StartChoices({
  state,
  width,
  contentRows,
}: {
  state: Extract<AddProjectFlowState, { mode: "start" }>;
  width: number;
  contentRows: number;
}) {
  const visible = state.choices.slice(0, Math.max(0, contentRows - 3));
  return (
    <>
      <SectionLine width={width}>Start location</SectionLine>
      <Line width={width}> </Line>
      {visible.map((choice, index) => (
        <PickerLine
          key={choice.path}
          width={width}
          selected={index === state.selectedIndex}
          label={choice.label}
          detail={choice.detail}
        />
      ))}
      <Fill count={Math.max(0, contentRows - visible.length - 3)} width={width} />
      <Footer width={width}>Enter:open Right:open Esc:cancel</Footer>
    </>
  );
}

function FolderPicker({
  state,
  width,
  contentRows,
}: {
  state: Extract<AddProjectFlowState, { mode: "choose" }>;
  width: number;
  contentRows: number;
}) {
  const rows = addProjectRows(state);
  const hasSearchPrompt = state.filterMode || state.filter.length > 0;
  const listHeight = Math.max(1, contentRows - (hasSearchPrompt ? 5 : 4));
  const start = Math.max(0, Math.min(state.selectedIndex, rows.length - listHeight));
  const visible = rows.slice(start, start + listHeight);
  if (state.filter.length > 0 && rows.length === 0) {
    return (
      <>
        <MetaLine width={width} label="Folder" value={state.currentPath} />
        <MetaLine width={width} label="Search" value={state.filter} />
        <MessageLine width={width} tone="muted">
          {state.searching ? "Searching likely code folders..." : "0 matches"}
        </MessageLine>
        <Line width={width}> </Line>
        <MessageLine width={width}>
          {state.searching ? "Looking under common project roots." : "No folders matched."}
        </MessageLine>
        <MessageLine width={width} tone="muted">
          Try another search or paste a full path.
        </MessageLine>
        <Fill count={Math.max(0, contentRows - 7)} width={width} />
        <Footer width={width}>Backspace:edit Ctrl-u:clear Esc:clear</Footer>
      </>
    );
  }
  return (
    <>
      <MetaLine width={width} label="Folder" value={state.currentPath} />
      {hasSearchPrompt ? (
        <MetaLine
          width={width}
          label="Search"
          value={
            state.filter.length > 0
              ? `${state.filter}   ${matchSummary(state, rows.length)}   ${start + 1}-${start + visible.length} of ${rows.length}`
              : ""
          }
        />
      ) : (
        <Line width={width}> </Line>
      )}
      {state.error === undefined ? null : (
        <MessageLine width={width} tone="danger">
          {state.error.message}
        </MessageLine>
      )}
      {state.searchError === undefined ? null : (
        <MessageLine width={width} tone="danger">
          {`Search failed: ${state.searchError.message}`}
        </MessageLine>
      )}
      {visible.map((row, index) => (
        <PickerLine
          key={`${row.kind}:${row.path}`}
          width={width}
          selected={start + index === state.selectedIndex}
          label={rowLabel(row)}
          detail={rowDetail(row.kind)}
        />
      ))}
      <Fill count={Math.max(0, contentRows - visible.length - 4)} width={width} />
      <Footer width={width}>
        {state.filterMode
          ? "Type search/path Backspace:edit Ctrl-u:clear Esc:clear"
          : "Enter:choose Right:open Left:parent / search or path Esc:cancel"}
      </Footer>
    </>
  );
}

function rowLabel(row: ReturnType<typeof addProjectRows>[number]): string {
  if (row.kind === "current") {
    return ".";
  }
  if (row.kind === "search") {
    return `${row.displayPath ?? row.path}/`;
  }
  return `${row.name}/`;
}

function rowDetail(rowKind: ReturnType<typeof addProjectRows>[number]["kind"]): string {
  if (rowKind === "current") {
    return "this folder";
  }
  return rowKind === "search" ? "match" : "folder";
}

function matchSummary(state: Extract<AddProjectFlowState, { mode: "choose" }>, count: number) {
  const suffix = state.searchTruncated ? "+" : "";
  return state.searching ? `${count}${suffix} matches, searching` : `${count}${suffix} matches`;
}

function Review({
  state,
  width,
}: {
  state: Extract<AddProjectFlowState, { mode: "review" }>;
  width: number;
}) {
  return (
    <>
      <Line width={width}> </Line>
      <LabelValue width={width} label="Selected folder" value={state.selectedPath} />
      <LabelValue width={width} label="Git root" value={state.gitRoot ?? "not detected"} />
      <LabelValue
        width={width}
        label="Project id"
        value={
          state.editingId === undefined ? state.id : <EditableTextInput {...state.editingId} />
        }
      />
      <LabelValue width={width} label="Display name" value={state.label} />
      {state.gitRoot === undefined ? (
        <>
          <Line width={width}> </Line>
          <MessageLine width={width} tone="warning">
            This does not look like a git repository.
          </MessageLine>
        </>
      ) : (
        <Line width={width}> </Line>
      )}
      {state.submitting ? (
        <ProgressFooter width={width}>Adding project</ProgressFooter>
      ) : (
        <Footer width={width}>{reviewFooter(state)}</Footer>
      )}
    </>
  );
}

function Success({
  state,
  width,
}: {
  state: Extract<AddProjectFlowState, { mode: "success" }>;
  width: number;
}) {
  return (
    <>
      <Line width={width}> </Line>
      <LabelValue width={width} label="Project" value={state.label} />
      <LabelValue width={width} label="Root" value={state.root} />
      <Line width={width}> </Line>
      <MessageLine width={width} tone="success">
        Config updated. Reconciled successfully.
      </MessageLine>
      <Line width={width}> </Line>
      <Footer width={width}>Enter:dashboard Esc:dashboard</Footer>
    </>
  );
}

function Failure({
  state,
  width,
  contentRows,
}: {
  state: Extract<AddProjectFlowState, { mode: "failed" }>;
  width: number;
  contentRows: number;
}) {
  const staticRows = state.error.hint === undefined ? 5 : 6;
  const metadataRows = failureMetadataRows(state.error).slice(
    0,
    Math.max(0, contentRows - staticRows),
  );
  return (
    <>
      <MessageLine width={width} tone="danger">
        Could not update config.toml.
      </MessageLine>
      <Line width={width}> </Line>
      <MessageLine width={width}>{state.error.message}</MessageLine>
      {state.error.hint === undefined ? null : (
        <MessageLine width={width} tone="muted">
          {state.error.hint}
        </MessageLine>
      )}
      {metadataRows.map((row) => (
        <MetaLine key={row.label} width={width} label={row.label} value={row.value} />
      ))}
      <Line width={width}> </Line>
      <Footer width={width}>R:retry B:choose folder Esc:cancel</Footer>
    </>
  );
}

function failureMetadataRows(
  error: Extract<AddProjectFlowState, { mode: "failed" }>["error"],
): Array<{ label: string; value: string }> {
  const rows = [{ label: "Code", value: error.code }];
  if (error.traceId !== undefined) rows.push({ label: "Trace", value: error.traceId });
  if (error.commandId !== undefined) rows.push({ label: "Command", value: error.commandId });
  if (error.diagnosticId !== undefined) {
    rows.push({ label: "Diag", value: error.diagnosticId });
  }
  return rows;
}

function reviewFooter(state: Extract<AddProjectFlowState, { mode: "review" }>): string {
  if (state.editingId !== undefined) {
    return "Enter:save id   Esc:cancel edit";
  }
  return state.gitRoot === undefined
    ? "Enter:add anyway   N:edit id   B:choose folder   Esc:cancel"
    : "Enter:add project   N:edit id   B:choose folder   Esc:cancel";
}

function titleForState(state: AddProjectFlowState): string {
  if (state.mode === "start") return "Add Project";
  if (state.mode === "choose") return "Choose Project Folder";
  if (state.mode === "review") return "Add Project: Review";
  if (state.mode === "success") return "Project Added";
  return "Add Project Failed";
}

function fixedSheetHeight(rows: number): number {
  return Math.min(Math.max(1, rows - 2), 18);
}
