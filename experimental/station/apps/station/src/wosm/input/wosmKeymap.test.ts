// The anti-drift suite pinning the keymap DATA to the shared transition
// machine (the single behavioral source):
//
// 1. Inverse coverage — for every mode and a broad probe-key space, any key
//    the machine handles must be matched by exactly one binding. A key the
//    machine handles that no binding documents is the omission-drift failure
//    the keymap-as-data requirement exists to prevent.
// 2. Stale bindings — a matched binding whose probe the machine ignores is
//    only legal for declared runtime-data cases (unassigned slots, the
//    addProject union table).
// 3. Outcome conformance — every binding's declared outcome must equal the
//    outcome derived from actually dispatching its key (close-overlay iff
//    the transition reports dismissPopup/exitCode).
import { describe, expect, it } from "bun:test";
import { attentionAndFailuresSnapshot, manyProjectsSnapshot } from "../fixtures/scenarios.js";
import { createInitialTuiState } from "@wosm/dashboard-core";
import type { TuiKey } from "@wosm/dashboard-core";
import { handleTuiKey } from "@wosm/dashboard-core";
import type { TuiState } from "@wosm/dashboard-core";
import {
  deriveWosmMode,
  matchWosmBinding,
  WOSM_KEYMAP,
  type WosmInputMode,
} from "./wosmKeymap.js";

const KEY_CONTEXT = { cwd: "/Users/example/Developer/wosm", homeDir: "/Users/example" };

/** Bindings allowed to match keys the machine may ignore, with the reason. */
const ALLOWED_NOOP_BINDINGS = new Set([
  // Slot patterns cover the whole 1-9 a-z accelerator space; whether a slot
  // is assigned is viewport runtime data.
  "wosm.dashboard.slotActivate",
  "wosm.collapse.toggleSlot",
  "wosm.remove.chooseSlot",
  "wosm.rename.chooseSlot",
  "wosm.newSessionProject.choose",
  "wosm.newSessionAgent.choose",
  // The addProject table is the union over the flow's sub-modes; which keys
  // apply depends on flow.mode (documented on the table).
  "wosm.addProject.cancel",
  "wosm.addProject.confirm",
  "wosm.addProject.up",
  "wosm.addProject.down",
  "wosm.addProject.left",
  "wosm.addProject.right",
  "wosm.addProject.backspace",
  "wosm.addProject.delete",
  "wosm.addProject.clearLine",
  "wosm.addProject.type",
]);

function probeKeys(): TuiKey[] {
  const keys: TuiKey[] = [];
  for (let code = 0x20; code <= 0x7e; code += 1) {
    keys.push({ input: String.fromCharCode(code) });
  }
  for (let code = 0; code < 26; code += 1) {
    keys.push({ input: String.fromCharCode(0x61 + code), ctrl: true });
  }
  keys.push({ input: "\r", return: true });
  keys.push({ input: "", escape: true });
  keys.push({ input: "", backspace: true });
  keys.push({ input: "", delete: true });
  keys.push({ input: "", upArrow: true });
  keys.push({ input: "", downArrow: true });
  keys.push({ input: "", leftArrow: true });
  keys.push({ input: "", rightArrow: true });
  return keys;
}

function dashboardState(): TuiState {
  return createInitialTuiState({
    initialSnapshot: manyProjectsSnapshot(),
    runtime: { persistentPopup: true, canDismissPopup: true },
  });
}

function drive(state: TuiState, keys: TuiKey[]): TuiState {
  let current = state;
  for (const key of keys) {
    current = handleTuiKey(current, key, KEY_CONTEXT).state;
  }
  return current;
}

/**
 * Representative states for every mode, built by driving the machine from
 * the dashboard with real keys — if a path here breaks, the mode itself
 * broke. The rename path uses the attention fixture's first slot, whose row
 * has a session.
 */
function representativeStates(): Record<WosmInputMode, TuiState> {
  const base = dashboardState();
  const renameBase = createInitialTuiState({
    initialSnapshot: attentionAndFailuresSnapshot(),
    runtime: { persistentPopup: true, canDismissPopup: true },
  });
  return {
    dashboard: base,
    help: drive(base, [{ input: "H" }]),
    search: drive(base, [{ input: "/" }, { input: "ab" }]),
    projectCollapse: drive(base, [{ input: "C" }]),
    removeChooseSlot: drive(base, [{ input: "X" }]),
    removeConfirm: drive(base, [{ input: "X" }, { input: "1" }]),
    renameChooseSlot: drive(renameBase, [{ input: "R" }]),
    renameEdit: drive(renameBase, [{ input: "R" }, { input: "1" }]),
    newSessionReview: drive(base, [{ input: "N" }]),
    newSessionEditName: drive(base, [{ input: "N" }, { input: "N" }]),
    newSessionPickProject: drive(base, [{ input: "N" }, { input: "P" }]),
    newSessionPickAgent: drive(base, [{ input: "N" }, { input: "A" }]),
    addProject: drive(base, [{ input: "A" }]),
  };
}

function machineHandled(state: TuiState, key: TuiKey): boolean {
  const transition = handleTuiKey(state, key, KEY_CONTEXT);
  return (
    transition.state !== state ||
    transition.commands !== undefined ||
    transition.operations !== undefined ||
    transition.reconcileReason !== undefined ||
    transition.exitCode !== undefined ||
    transition.dismissPopup === true
  );
}

describe("wosm keymap coverage", () => {
  const states = representativeStates();

  it("derives the expected mode for every representative state", () => {
    for (const [mode, state] of Object.entries(states)) {
      expect(`${mode}:${deriveWosmMode(state)}`).toBe(`${mode}:${mode}`);
    }
  });

  it("documents every machine-handled key with exactly one binding (no omission drift)", () => {
    const failures: string[] = [];
    for (const [mode, state] of Object.entries(states) as Array<[WosmInputMode, TuiState]>) {
      for (const key of probeKeys()) {
        const handled = machineHandled(state, key);
        const binding = matchWosmBinding(mode, key);
        if (handled && binding === undefined) {
          failures.push(`${mode}: machine handles ${describeKey(key)} but no binding matches`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("has no stale bindings outside the declared runtime-data cases", () => {
    const failures: string[] = [];
    for (const [mode, state] of Object.entries(states) as Array<[WosmInputMode, TuiState]>) {
      for (const key of probeKeys()) {
        const binding = matchWosmBinding(mode, key);
        if (binding === undefined) {
          continue;
        }
        if (!machineHandled(state, key) && !ALLOWED_NOOP_BINDINGS.has(binding.id)) {
          failures.push(`${mode}: ${binding.id} matches ${describeKey(key)} but the machine ignores it`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("declares outcomes that match what dispatching actually produces", () => {
    const failures: string[] = [];
    for (const [mode, state] of Object.entries(states) as Array<[WosmInputMode, TuiState]>) {
      for (const key of probeKeys()) {
        const binding = matchWosmBinding(mode, key);
        if (binding === undefined) {
          continue;
        }
        const transition = handleTuiKey(state, key, KEY_CONTEXT);
        const derived =
          transition.dismissPopup === true || transition.exitCode !== undefined
            ? "close-overlay"
            : "handled";
        if (binding.outcome !== derived) {
          failures.push(
            `${mode}: ${binding.id} declares ${binding.outcome} but ${describeKey(key)} derives ${derived}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("matches at most one specific binding per key (text catch-alls last)", () => {
    for (const mode of Object.keys(WOSM_KEYMAP) as WosmInputMode[]) {
      const table = WOSM_KEYMAP[mode];
      const textIndex = table.findIndex((binding) => binding.pattern.kind === "text");
      if (textIndex !== -1) {
        expect(`${mode}:${textIndex}`).toBe(`${mode}:${table.length - 1}`);
      }
    }
  });
});

function describeKey(key: TuiKey): string {
  const flags = Object.entries(key)
    .filter(([name, value]) => name !== "input" && value === true)
    .map(([name]) => name)
    .join("+");
  return `{input:${JSON.stringify(key.input)}${flags ? ` ${flags}` : ""}}`;
}
