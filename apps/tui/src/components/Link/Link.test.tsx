import { Box, renderToString, Text } from "ink";
import { describe, expect, it } from "vitest";
import { formatLink, Link } from "./Link.js";

describe("Link", () => {
  it("formats OSC 8 links with a stable id", () => {
    const url = "https://github.com/example/web/pull/123";

    expect(formatLink(url, "#123")).toBe(
      "\u001B]8;id=wosm-fNrWuVdbZiLi;https://github.com/example/web/pull/123\u0007#123\u001B]8;;\u0007",
    );
  });

  it("wraps rendered text without including surrounding separators", () => {
    const url = "https://github.com/example/web/pull/123";
    const frame = renderToString(
      <Box>
        <Text> </Text>
        <Link url={url}>
          <Text underline>#123</Text>
        </Link>
      </Box>,
    );

    expect(frame).toContain(
      " \u001B]8;id=wosm-fNrWuVdbZiLi;https://github.com/example/web/pull/123\u0007#123",
    );
  });
});
