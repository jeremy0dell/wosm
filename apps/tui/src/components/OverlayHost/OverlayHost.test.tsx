import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { createDashboardSnapshot } from "../../../test/fixtures/snapshots.js";
import { createNewSessionFlow } from "../../flows/newSession.js";
import { createEditableTextInputState } from "../EditableTextInput/editing.js";
import { OverlayHost } from "./OverlayHost.js";

describe("OverlayHost", () => {
  it("places overlay content absolutely without adding rows or shifting siblings", () => {
    const rows = 12;
    const columns = 60;
    const dashboardRows = Array.from({ length: rows }, (_, index) => ({
      key: `row-${index}`,
      text: `row-${index.toString().padStart(2, "0")}`,
    }));
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          {dashboardRows.map((row) => (
            <Text key={row.key}>{row.text}</Text>
          ))}
          <OverlayHost
            columns={columns}
            rows={rows}
            screen={{ name: "help" }}
            snapshot={createDashboardSnapshot()}
          />
        </Box>,
        { columns },
      ),
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(rows);
    expect(lines[0]).toContain("row-00");
    expect(lines[1]).toContain("row-01");
    expect(lines.at(-1)).toContain("row-11");
    expect(frame).toContain("wosm help");
  });

  it("renders nothing when no overlay is active", () => {
    const rows = 4;
    const columns = 40;
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          <Text>top</Text>
          <Text>bottom</Text>
          <OverlayHost
            columns={columns}
            rows={rows}
            screen={{ name: "dashboard" }}
            snapshot={createDashboardSnapshot()}
          />
        </Box>,
        { columns },
      ),
    );

    expect(frame.split("\n")).toHaveLength(4);
    expect(frame).toContain("top");
    expect(frame).toContain("bottom");
    expect(frame).not.toContain("wosm help");
  });

  it("renders the new-session sheet from a typed overlay model", () => {
    const rows = 16;
    const columns = 72;
    const snapshot = createDashboardSnapshot();
    const state = createNewSessionFlow(snapshot, "k7p3x9");
    if (state === undefined) throw new Error("expected a flow");

    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={columns} height={rows}>
          <Text>dashboard footer</Text>
          <OverlayHost
            columns={columns}
            rows={rows}
            screen={{ name: "newSession", flow: state }}
            snapshot={snapshot}
          />
        </Box>,
        { columns },
      ),
    );

    expect(frame).toContain("New Session");
    expect(frame).toContain("Project   web");
    expect(frame).toContain("Name      web-k7p3x9");
  });

  it("renders the rename sheet only for edit-name rename state", () => {
    const frame = stripAnsi(
      renderToString(
        <Box position="relative" flexDirection="column" width={72} height={16}>
          <Text>dashboard footer</Text>
          <OverlayHost
            columns={72}
            rows={16}
            screen={{
              name: "renameSession",
              step: "editName",
              rowId: "wt_web_idle",
              sessionId: "ses_wt_web_idle",
              currentTitle: "Readable feature task",
              draftTitle: createEditableTextInputState("Readable feature task"),
            }}
            snapshot={createDashboardSnapshot()}
          />
        </Box>,
        { columns: 72 },
      ),
    );

    expect(frame).toContain("Rename Session");
    expect(frame).toContain("Name      Readable feature task|");
  });
});

function stripAnsi(value: string): string {
  return value.replace(ansiEscapePattern(), "");
}

function ansiEscapePattern(): RegExp {
  return new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
}
