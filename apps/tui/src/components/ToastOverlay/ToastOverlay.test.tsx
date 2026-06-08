import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { row } from "../../../test/fixtures/snapshots.js";
import type { TuiToastEntry } from "../../state/screen.js";
import { stripTerminalLinks } from "../Link/Link.js";
import { WorktreeRow } from "../WorktreeRow/WorktreeRow.js";
import { ToastOverlay } from "./ToastOverlay.js";

describe("ToastOverlay", () => {
  it("renders nothing without an active toast", () => {
    expect(
      renderToString(
        <ToastOverlay
          columns={80}
          rows={16}
          toast={undefined}
          promptRows={0}
          hiddenByModal={false}
        />,
      ),
    ).toBe("");
  });

  it("hides below modal overlays", () => {
    expect(
      renderToString(
        <ToastOverlay
          columns={80}
          rows={16}
          toast={toastEntry({ kind: "success", message: "Session renamed." })}
          promptRows={0}
          hiddenByModal={true}
        />,
      ),
    ).toBe("");
  });

  it("renders success, info, and error titles", () => {
    expect(renderToast(toastEntry({ kind: "success", message: "Session renamed." }))).toContain(
      "saved",
    );
    expect(renderToast(toastEntry({ kind: "info", message: "Snapshot refreshed." }))).toContain(
      "notice",
    );
    expect(
      renderToast(toastEntry({ kind: "error", message: "Worktree remove failed." })),
    ).toContain("needs attention");
  });

  it("renders observer recovery success with connected title", () => {
    const frame = renderToast(toastEntry({ kind: "success", message: "Observer reconnected." }));

    expect(frame).toContain("connected");
    expect(frame).toContain("Observer reconnected.");
  });

  it("aligns the title and message text on the same content column", () => {
    const frame = renderToast(
      toastEntry({
        kind: "error",
        message: "Observer protocol method timed out.",
      }),
    );
    const lines = frame.split("\n");
    const titleLine = lines.find((line) => line.includes("needs attention"));
    const messageLine = lines.find((line) => line.includes("Observer protocol method timed out."));

    expect(titleLine).toBeDefined();
    expect(messageLine).toBeDefined();
    expect(titleLine?.indexOf("needs attention")).toBe(
      messageLine?.indexOf("Observer protocol method timed out."),
    );
  });

  it("formats hint, trace, and diagnostic details without provider payloads", () => {
    const frame = renderToast(
      toastEntry({
        kind: "error",
        message: "Worktree remove failed.",
        hint: "Retry.",
        traceId: "trc_1",
        diagnosticId: "diag_2",
      }),
    );

    expect(frame).toContain("Retry.");
    expect(frame).toContain("trace trc_1");
    expect(frame).toContain("diagnostic diag_2");
    expect(frame).not.toContain("providerData");
  });

  it("keeps narrow output within the viewport", () => {
    const frame = renderToast(
      toastEntry({
        kind: "error",
        message: "A very long command failure message that must not push the terminal wider.",
      }),
      { columns: 44, rows: 16 },
    );

    for (const line of stripAnsiAndOsc(frame).split("\n")) {
      expect(line.length).toBeLessThanOrEqual(44);
    }
    expect(stripAnsiAndOsc(frame)).toContain("needs attention");
  });

  it("paints a blank backing over covered dashboard text", () => {
    const frame = stripAnsiAndOsc(
      renderToString(
        <Box position="relative" flexDirection="column" width={80} height={12}>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>BACKGROUND</Text>
          <Text>{" ".repeat(30)}RIGHT SIDE DASHBOARD TEXT THAT SHOULD DISAPPEAR</Text>
          <ToastOverlay
            columns={80}
            rows={12}
            toast={toastEntry({ kind: "success", message: "Session renamed." })}
            promptRows={0}
            hiddenByModal={false}
          />
        </Box>,
        { columns: 80 },
      ),
    );

    expect(frame).toContain("Session renamed.");
    expect(frame).not.toContain("RIGHT SIDE DASHBOARD TEXT");
  });

  it("removes covered OSC-8 PR link output while leaving uncovered links intact", () => {
    const coveredUrl = "https://example.com/pull/42";
    const uncoveredUrl = "https://example.com/pull/41";
    const rawFrame = renderToString(
      <Box position="relative" flexDirection="column" width={80} height={12}>
        <Text>top row</Text>
        <WorktreeRow row={linkedRow(41, uncoveredUrl)} slot="1" columns={80} />
        <Text>middle row</Text>
        <Text>middle row</Text>
        <Text>middle row</Text>
        <WorktreeRow row={linkedRow(42, coveredUrl)} slot="2" columns={80} />
        <Text>bottom row</Text>
        <ToastOverlay
          columns={80}
          rows={12}
          toast={toastEntry({ kind: "error", message: "Worktree remove failed." })}
          promptRows={0}
          hiddenByModal={false}
        />
      </Box>,
      { columns: 80 },
    );
    const visualFrame = stripAnsiAndOsc(rawFrame);

    expect(rawFrame).toContain(uncoveredUrl);
    expect(visualFrame).toContain("#41");
    expect(rawFrame).not.toContain(coveredUrl);
    expect(visualFrame).not.toContain("#42");
    expect(visualFrame).toContain("Worktree remove failed.");
    expect(visualFrame).toContain("bottom row");
  });
});

function renderToast(
  entry: TuiToastEntry,
  size: { columns: number; rows: number } = { columns: 80, rows: 16 },
) {
  return stripAnsiAndOsc(
    renderToString(
      <Box position="relative" flexDirection="column" width={size.columns} height={size.rows}>
        <ToastOverlay
          columns={size.columns}
          rows={size.rows}
          toast={entry}
          promptRows={0}
          hiddenByModal={false}
        />
      </Box>,
      { columns: size.columns },
    ),
  );
}

function toastEntry(toast: TuiToastEntry["toast"]): TuiToastEntry {
  return {
    id: "toast_1",
    toast,
    createdAt: 100,
    updatedAt: 100,
    expiresAt: 2_500,
  };
}

function linkedRow(number: number, url: string) {
  const linked = row({
    id: `wt_linked_${number}`,
    projectId: "web",
    branch: `linked-${number}`,
    state: "idle",
  });
  return {
    ...linked,
    worktree: {
      ...linked.worktree,
      pr: {
        number,
        url,
        stale: false,
      },
    },
  };
}

function stripAnsiAndOsc(value: string): string {
  return stripAnsi(stripTerminalLinks(value));
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}
