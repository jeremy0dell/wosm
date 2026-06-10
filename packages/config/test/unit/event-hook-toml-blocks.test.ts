import { appendObserverEventHookBlock, removeObserverEventHookBlocksById } from "@wosm/config";
import { describe, expect, it } from "vitest";

describe("observer event hook TOML blocks", () => {
  it("appends an observer event hook block with stable spacing", () => {
    const source = ["schema_version = 1", "projects = []", ""].join("\n");

    const result = appendObserverEventHookBlock(
      source,
      [
        "[[hooks.event]]",
        'id = "notify-agent-idle"',
        'events = ["worktree.agentStateChanged"]',
      ].join("\n"),
    );

    expect(result).toBe(
      [
        "schema_version = 1",
        "projects = []",
        "",
        "[[hooks.event]]",
        'id = "notify-agent-idle"',
        'events = ["worktree.agentStateChanged"]',
        "",
      ].join("\n"),
    );
  });

  it("removes every observer event hook block with the requested id", () => {
    const source = [
      "schema_version = 1",
      "projects = []",
      "",
      "[[hooks.event]]",
      'id = "notify-agent-idle"',
      'command = "osascript"',
      "",
      "[hooks.event.filter]",
      'agent_state = "idle"',
      "",
      "[[hooks.event]]",
      "id = 'notify-agent-idle'",
      'command = "wosm"',
      "",
      "[hooks.event.filter]",
      'change_source = "harness_event_report"',
      "",
      "[[hooks.event]]",
      'id = "keep-me"',
      'command = "wosm"',
      "",
      "[observer]",
      'state_dir = "/tmp/wosm"',
      "",
    ].join("\n");

    const result = removeObserverEventHookBlocksById(source, "notify-agent-idle");

    expect(result).toBe(
      [
        "schema_version = 1",
        "projects = []",
        "",
        "[[hooks.event]]",
        'id = "keep-me"',
        'command = "wosm"',
        "",
        "[observer]",
        'state_dir = "/tmp/wosm"',
      ].join("\n"),
    );
  });

  it("leaves the source unchanged when the hook id is absent", () => {
    const source = [
      "schema_version = 1",
      "",
      "[[hooks.event]]",
      'id = "keep-me"',
      'command = "wosm"',
      "",
    ].join("\n");

    expect(removeObserverEventHookBlocksById(source, "missing")).toBe(source);
  });
});
