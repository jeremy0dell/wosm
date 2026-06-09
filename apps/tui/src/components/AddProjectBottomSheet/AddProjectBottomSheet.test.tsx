import { Box, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AddProjectBottomSheet } from "./AddProjectBottomSheet.js";

describe("AddProjectBottomSheet", () => {
  it("shows an empty search prompt as soon as slash mode starts", () => {
    const frame = renderToString(
      <Box flexDirection="column" width={80} height={12}>
        <AddProjectBottomSheet
          columns={80}
          rows={12}
          state={{
            mode: "choose",
            stepHistory: [],
            currentPath: "/Users/example/Desktop/projects",
            entries: [
              {
                name: "GermStack",
                path: "/Users/example/Desktop/projects/GermStack",
                kind: "directory",
              },
            ],
            selectedIndex: 0,
            filter: "",
            filterMode: true,
            loading: false,
            searchEntries: [],
            searching: false,
            searchTruncated: false,
          }}
        />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain(" Search");
    expect(frame).toContain("Type search/path");
    expect(frame).toContain("GermStack/");
  });

  it("keeps no-results picker state inside a fixed-height sheet", () => {
    const frame = renderToString(
      <Box flexDirection="column" width={80} height={12}>
        <AddProjectBottomSheet
          columns={80}
          rows={12}
          state={{
            mode: "choose",
            stepHistory: [],
            currentPath: "/Users/example/Developer",
            entries: [{ name: "wosm", path: "/Users/example/Developer/wosm", kind: "directory" }],
            selectedIndex: 0,
            filter: "zzz-nope",
            filterMode: true,
            loading: false,
            searchEntries: [],
            searching: false,
            searchTruncated: false,
          }}
        />
      </Box>,
      { columns: 80 },
    );
    const lines = frame.split("\n");

    expect(lines).toHaveLength(12);
    expect(frame).toContain("Choose Project Folder");
    expect(frame).toContain("0 matches");
    expect(frame).toContain("No folders matched.");
    expect(frame).toContain("Backspace:edit");
  });

  it("renders success details as labeled metadata without leading punctuation", () => {
    const frame = renderToString(
      <Box flexDirection="column" width={80} height={12}>
        <AddProjectBottomSheet
          columns={80}
          rows={12}
          state={{
            mode: "success",
            stepHistory: [],
            id: "germstack",
            label: "GermStack",
            root: "/Users/example/Desktop/projects/GermStack",
          }}
        />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain("Project");
    expect(frame).toContain("GermStack");
    expect(frame).toContain("Root");
    expect(frame).toContain("/Users/example/Desktop/projects/GermStack");
    expect(frame).not.toContain(",GermStack");
    expect(frame).not.toContain(",/Users/example/Desktop/projects/GermStack");
  });

  it("renders submitting review state with an animated dot throbber", () => {
    const frame = renderToString(
      <Box flexDirection="column" width={80} height={12}>
        <AddProjectBottomSheet
          columns={80}
          rows={12}
          state={{
            mode: "review",
            stepHistory: [],
            selectedPath: "/Users/example/Desktop/projects/GermStack",
            gitRoot: "/Users/example/Desktop/projects/GermStack",
            id: "germstack",
            label: "GermStack",
            submitting: true,
          }}
        />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain("Adding project.");
    expect(frame).not.toContain("Enter:add project");
  });

  it("renders safe error metadata on failed project adds", () => {
    const frame = renderToString(
      <Box flexDirection="column" width={80} height={18}>
        <AddProjectBottomSheet
          columns={80}
          rows={18}
          state={{
            mode: "failed",
            stepHistory: [],
            selectedPath: "/Users/example/Desktop/projects/GermStack",
            error: {
              tag: "ProtocolError",
              code: "PROTOCOL_VALIDATION_FAILED",
              message: "Observer protocol payload failed validation.",
              hint: "Restart the observer so it loads the current schema.",
              traceId: "trc_add_project_1",
              commandId: "cmd_add_project_1",
              diagnosticId: "diag_add_project_1",
            },
          }}
        />
      </Box>,
      { columns: 80 },
    );

    expect(frame).toContain("Could not update config.toml.");
    expect(frame).toContain("Observer protocol payload failed validation.");
    expect(frame).toContain("Code");
    expect(frame).toContain("PROTOCOL_VALIDATION_FAILED");
    expect(frame).toContain("Trace");
    expect(frame).toContain("trc_add_project_1");
    expect(frame).toContain("Command");
    expect(frame).toContain("cmd_add_project_1");
    expect(frame).toContain("Diag");
    expect(frame).toContain("diag_add_project_1");
  });
});
