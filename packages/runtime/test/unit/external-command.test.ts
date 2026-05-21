import {
  createFakeExternalCommandRunner,
  externalCommandErrorFromUnknown,
  nodeExternalCommandRunner,
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

  it("aborts fakeable command execution on timeout", async () => {
    let aborted = false;
    const runner = createFakeExternalCommandRunner(
      (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
          });
        }),
    );

    await expect(
      runExternalCommand({ command: "fake", args: ["hang"], timeoutMs: 5 }, runner),
    ).rejects.toMatchObject({
      tag: "ExternalCommandError",
      code: "EXTERNAL_COMMAND_TIMEOUT",
      command: "fake hang",
    });
    expect(aborted).toBe(true);
  });

  it("does not let the node runner own timeout semantics", async () => {
    await expect(
      nodeExternalCommandRunner({
        command: process.execPath,
        args: ["-e", "setTimeout(() => console.log('ok'), 20)"],
        timeoutMs: 1,
      }),
    ).resolves.toMatchObject({
      stdout: "ok\n",
      exitCode: 0,
    });
  });

  it("propagates caller cancellation into the command runner", async () => {
    const controller = new AbortController();
    let aborted = false;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const pending = runExternalCommand(
      { command: "fake", args: ["cancel"], signal: controller.signal },
      createFakeExternalCommandRunner(
        (input) =>
          new Promise((_, reject) => {
            input.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }),
              );
            });
            resolveReady();
          }),
      ),
    );

    await ready;
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      tag: "ExternalCommandError",
      code: "EXTERNAL_COMMAND_ABORTED",
      command: "fake cancel",
    });
    expect(aborted).toBe(true);
  });

  it("keeps caller cancellation distinct from runtime timeouts", async () => {
    const controller = new AbortController();
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const pending = runExternalCommand(
      {
        command: "fake",
        args: ["cancel-with-timeout"],
        signal: controller.signal,
        timeoutMs: 1000,
      },
      createFakeExternalCommandRunner(
        (input) =>
          new Promise((_, reject) => {
            input.signal?.addEventListener("abort", () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }),
              );
            });
            resolveReady();
          }),
      ),
    );

    await ready;
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      tag: "ExternalCommandError",
      code: "EXTERNAL_COMMAND_ABORTED",
      command: "fake cancel-with-timeout",
    });
  });
});
