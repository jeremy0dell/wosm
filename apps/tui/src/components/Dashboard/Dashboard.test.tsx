import { Box, renderToString, Text } from "ink";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import stringWidth from "string-width";
import { describe, expect, it, vi } from "vitest";
import { createDashboardSnapshot } from "../../../test/fixtures/snapshots.js";
import { Dashboard, dashboardHeaderLine } from "./Dashboard.js";

describe("Dashboard", () => {
  it("respects collapsed project ids when rendering groups and slots", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={24} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(["web"]),
            scrollOffset: 0,
            terminalRows: 24,
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [], pendingStart: [] },
          }}
        />
      </Box>,
      { columns: 100 },
    );

    expect(frame).toContain("▶ web - 7 worktrees");
    expect(frame).not.toContain("| codex");
    expect(frame).not.toContain("cache-refactor");
    expect(frame).not.toContain("slow-tests");
    expect(frame).toContain("▼ api - 1 worktrees");
    expect(frame).not.toContain("| opencode");
    expect(frame).toContain(" [1] ◜ queue-worker");
  });

  it("clips body rows to the viewport and renders scroll indicators", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={10} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(),
            scrollOffset: 1,
            terminalRows: 10,
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [], pendingStart: [] },
          }}
        />
      </Box>,
      { columns: 100 },
    );
    const lines = frame.split("\n");
    const body = lines.slice(3, -3).join("\n");

    expect(lines).toHaveLength(10);
    expect(lines[2]).toContain("↑ 1 hidden");
    expect(lines.at(-2)).toHaveLength(99);
    expect(body).toContain(" [1] ◜ cache-refactor");
    expect(body).toContain(" [4] - feature-auth");
    expect(body).not.toContain("fix-nav-mobile");
    expect(body).not.toContain("queue-worker");
    expect(lines.at(-3)).toContain("↓ 6 hidden");
    expect(lines.at(-2)).toMatch(/^─+$/);
    expect(lines.at(-1)).toContain("N:new");
  });

  it("renders the footer in the default terminal foreground for contrast", () => {
    const snapshot = createDashboardSnapshot();
    const props = dashboardFooterTextProps(
      <Dashboard
        columns={100}
        snapshot={snapshot}
        viewState={{
          searchQuery: "",
          collapsedProjectIds: new Set(),
          scrollOffset: 0,
          terminalRows: 24,
          localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [], pendingStart: [] },
        }}
      />,
    );

    expect(props.children).toContain("N:new");
    expect(props.children).toContain("R:rename");
    expect(props.children).not.toContain("refresh");
    expect(props.color).toBeUndefined();
    expect(props.dimColor).toBe(false);
  });

  it("renders local operation rows with the intended slot labels", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={24} width={100}>
        <Dashboard
          columns={100}
          snapshot={snapshot}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(),
            scrollOffset: 0,
            terminalRows: 24,
            localRows: {
              pendingCreate: [
                {
                  localId: "local_create_1",
                  projectId: "web",
                  branch: "feature/pending",
                  harnessProvider: "codex",
                  createdAt: "2026-05-31T12:00:00.000Z",
                },
              ],
              failedCreate: [],
              pendingRemove: [
                {
                  localId: "remove:wt_web_idle",
                  projectId: "web",
                  worktreeId: "wt_web_idle",
                  branch: "fix-nav-mobile",
                  createdAt: "2026-05-31T12:00:00.000Z",
                },
              ],
              pendingStart: [
                {
                  localId: "start:wt_web_no_agent",
                  projectId: "web",
                  worktreeId: "wt_web_no_agent",
                  branch: "feature-auth",
                  createdAt: "2026-05-31T12:00:00.000Z",
                },
              ],
            },
          }}
        />
      </Box>,
      { columns: 100 },
    );

    expect(frame).toContain(" [4] ⠋ feature-auth  starting...");
    expect(frame).toContain(" [ ] ⠋ feature/pending  starting session...");
    expect(frame).toContain(" [ ] ⠋ fix-nav-mobile  removing worktree...");
  });

  it("renders configured header widgets right-aligned in configured order", () => {
    const line = dashboardHeaderLine({
      productLabel: "wosm",
      columns: 40,
      widgets: [
        { id: "time:0", text: "10:42 AM" },
        { id: "weather:1", text: "NYC 72° ☀️" },
      ],
    });

    expect(line).toContain("wosm");
    expect(line.endsWith("10:42 AM  NYC 72° ☀️")).toBe(true);
    expect(stringWidth(line)).toBe(40);
  });

  it("honors widget order and hides later widgets first at narrow widths", () => {
    const widgets = [
      { id: "weather:0", text: "NYC 72° ☀️" },
      { id: "time:1", text: "10:42 AM" },
    ];

    expect(
      dashboardHeaderLine({
        productLabel: "wosm",
        columns: 40,
        widgets,
      }).endsWith("NYC 72° ☀️  10:42 AM"),
    ).toBe(true);
    expect(
      dashboardHeaderLine({
        productLabel: "wosm",
        columns: 22,
        widgets,
      }).endsWith("NYC 72° ☀️"),
    ).toBe(true);
    expect(
      dashboardHeaderLine({
        productLabel: "wosm",
        columns: 12,
        widgets,
      }),
    ).toBe("wosm");
  });

  it("keeps full emoji weather text on the header row without pushing the divider", () => {
    const snapshot = createDashboardSnapshot();
    const frame = renderToString(
      <Box flexDirection="column" height={10} width={28}>
        <Dashboard
          columns={28}
          snapshot={snapshot}
          topRowWidgets={[{ id: "weather:0", text: "NYC 72° ☀️" }]}
          viewState={{
            searchQuery: "",
            collapsedProjectIds: new Set(),
            scrollOffset: 0,
            terminalRows: 10,
            localRows: { pendingCreate: [], failedCreate: [], pendingRemove: [], pendingStart: [] },
          }}
        />
      </Box>,
      { columns: 28 },
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain("wosm");
    expect(lines[0]).toContain("NYC 72° ☀️");
    expect(lines[1]).toMatch(/^─+$/);
  });
});

function dashboardFooterTextProps(element: ReactElement): {
  children: string;
  color: string | undefined;
  dimColor: boolean;
} {
  let renderer: ReactTestRenderer | undefined;
  return withReactActEnvironment(() =>
    withSuppressedReactTestRendererWarning(() => {
      act(() => {
        renderer = create(element);
      });
      try {
        const textNodes = required(renderer).root.findAllByType(Text);
        const footerText = required(
          textNodes.find((node) => textContent(node.props.children).includes("N:new")),
        );
        const props = footerText.props as {
          children: unknown;
          color?: string;
          dimColor?: boolean;
        };
        return {
          children: textContent(props.children),
          color: props.color,
          dimColor: props.dimColor === true,
        };
      } finally {
        act(() => {
          renderer?.unmount();
        });
      }
    }),
  );
}

function textContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected value to exist.");
  }
  return value;
}

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function withReactActEnvironment<T>(callback: () => T): T {
  const actGlobal = globalThis as ReactActGlobal;
  const hadActEnvironment = "IS_REACT_ACT_ENVIRONMENT" in actGlobal;
  const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    return callback();
  } finally {
    if (hadActEnvironment) {
      actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    } else {
      delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
    }
  }
}

function withSuppressedReactTestRendererWarning<T>(callback: () => T): T {
  const originalError = console.error;
  const errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown, ...rest) => {
    if (typeof message === "string" && message.includes("react-test-renderer is deprecated")) {
      return;
    }
    originalError(message, ...rest);
  });
  try {
    return callback();
  } finally {
    errorSpy.mockRestore();
  }
}
