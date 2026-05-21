import {
  createFakeExternalCommandRunner,
  externalCommandErrorFromUnknown,
  runExternalCommand,
} from "@wosm/runtime";
import { describe, expect, it } from "vitest";

describe("runtime external command boundary", () => {
  it("supports fakeable command execution", async () => {
    const result = await runExternalCommand(
      { command: "fake", args: ["status"] },
      createFakeExternalCommandRunner(async (input) => ({
        command: input.command,
        args: input.args ?? [],
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      })),
    );

    expect(result).toEqual({
      command: "fake",
      args: ["status"],
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  });

  it("redacts command output in typed failures", () => {
    const error = externalCommandErrorFromUnknown(
      {
        message: "failed",
        stderr: "OPENAI_API_KEY=sk-secret000000000000 Bearer abcdefghijklmnop",
        stdout: "nothing",
        code: 1,
      },
      { command: "fake", args: ["run"] },
    );

    expect(error).toMatchObject({
      tag: "ExternalCommandError",
      command: "fake run",
      exitCode: 1,
    });
    expect(JSON.stringify(error)).not.toContain("sk-secret");
    expect(JSON.stringify(error)).not.toContain("abcdefghijklmnop");
  });
});
