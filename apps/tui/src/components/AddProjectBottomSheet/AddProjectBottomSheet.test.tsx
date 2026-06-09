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
});
