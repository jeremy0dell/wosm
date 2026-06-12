// The WOSM view's keymap as data. The ported transition machine
// (ported/state/transition.ts) stays the single behavioral source — these
// tables are the introspection contract over it: they drive the help overlay
// and footer hints, give mouse targets their action vocabulary, and are
// pinned to the machine by tests (wosmKeymap.test.ts asserts every
// machine-handled key has exactly one matching binding per mode, and that
// each binding's declared outcome matches what dispatching it produces).
// Runtime keyboard dispatch does NOT branch on these tables; it always goes
// through the machine, so a table omission can never change behavior — it
// fails the coverage test instead.
import { SELECTION_KEYS, type SelectionKey } from "../ported/selectors/selectors.js";
import type { TuiKey } from "../ported/state/keys.js";
import type { TuiState } from "../ported/state/types.js";

export type WosmInputMode =
  | "dashboard"
  | "help"
  | "search"
  | "projectCollapse"
  | "removeChooseSlot"
  | "removeConfirm"
  | "renameChooseSlot"
  | "renameEdit"
  | "newSessionReview"
  | "newSessionEditName"
  | "newSessionPickProject"
  | "newSessionPickAgent"
  | "addProject";

export function deriveWosmMode(state: TuiState): WosmInputMode {
  const screen = state.screen;
  switch (screen.name) {
    case "dashboard":
      return "dashboard";
    case "help":
      return "help";
    case "search":
      return "search";
    case "projectCollapse":
      return "projectCollapse";
    case "removeWorktree":
      return screen.step === "chooseSlot" ? "removeChooseSlot" : "removeConfirm";
    case "renameSession":
      return screen.step === "chooseSlot" ? "renameChooseSlot" : "renameEdit";
    case "newSession":
      switch (screen.flow.mode) {
        case "review":
          return "newSessionReview";
        case "editName":
          return "newSessionEditName";
        case "pickProject":
          return "newSessionPickProject";
        case "pickAgent":
          return "newSessionPickAgent";
      }
      break;
    case "addProject":
      return "addProject";
  }
  return "dashboard";
}

export type WosmKeyPattern =
  /** One exact key, matched on the TuiKey's printable input (case-sensitive). */
  | { kind: "char"; char: string; ctrl?: true }
  | {
      kind: "named";
      named: "return" | "escape" | "backspace" | "delete" | "up" | "down" | "left" | "right";
    }
  /** The visible-row slot accelerators (1-9 a-z, viewport-assigned). */
  | { kind: "slot" }
  /** Any printable input not claimed by another binding (text-entry modes). */
  | { kind: "text" };

/**
 * Outcomes mirror the router's vocabulary at the granularity the WOSM layer
 * produces: "handled" executes inside the view store and the router swallows
 * the key; "close-overlay" means the machine reported dismissPopup/exitCode
 * and the router closes WOSM mode via the coordination store.
 */
export type WosmBindingOutcome = "handled" | "close-overlay";

export type WosmBinding = {
  /** Stable id, "wosm.<mode>.<name>" — mouse targets reference these. */
  id: string;
  pattern: WosmKeyPattern;
  /** Semantic action id resolved by the wosmActions registry. */
  action: string;
  outcome: WosmBindingOutcome;
  /** Help-overlay / footer copy; bindings without help are chrome-invisible. */
  help?: { keys: string; label: string };
};

const slotHelp = { keys: "1-9 a-z", label: "start or focus visible row" };

export const WOSM_KEYMAP: Record<WosmInputMode, readonly WosmBinding[]> = {
  dashboard: [
    { id: "wosm.dashboard.scrollUp", pattern: { kind: "named", named: "up" }, action: "wosm.view.scrollUp", outcome: "handled" },
    { id: "wosm.dashboard.scrollDown", pattern: { kind: "named", named: "down" }, action: "wosm.view.scrollDown", outcome: "handled" },
    { id: "wosm.dashboard.help", pattern: { kind: "char", char: "H" }, action: "wosm.help.open", outcome: "handled", help: { keys: "H", label: "help" } },
    { id: "wosm.dashboard.helpAlias", pattern: { kind: "char", char: "?" }, action: "wosm.help.open", outcome: "handled" },
    { id: "wosm.dashboard.dismiss", pattern: { kind: "char", char: "Q" }, action: "wosm.overlay.dismiss", outcome: "close-overlay", help: { keys: "Q/esc", label: "close" } },
    { id: "wosm.dashboard.dismissEsc", pattern: { kind: "named", named: "escape" }, action: "wosm.overlay.dismiss", outcome: "close-overlay" },
    { id: "wosm.dashboard.search", pattern: { kind: "char", char: "/" }, action: "wosm.search.open", outcome: "handled", help: { keys: "/", label: "search" } },
    { id: "wosm.dashboard.rename", pattern: { kind: "char", char: "R" }, action: "wosm.rename.open", outcome: "handled", help: { keys: "R", label: "rename" } },
    { id: "wosm.dashboard.refresh", pattern: { kind: "char", char: "Z" }, action: "wosm.refresh", outcome: "handled", help: { keys: "Z", label: "refresh" } },
    { id: "wosm.dashboard.remove", pattern: { kind: "char", char: "X" }, action: "wosm.remove.open", outcome: "handled", help: { keys: "X", label: "rm" } },
    { id: "wosm.dashboard.newSession", pattern: { kind: "char", char: "N" }, action: "wosm.newSession.open", outcome: "handled", help: { keys: "N", label: "new" } },
    { id: "wosm.dashboard.addProject", pattern: { kind: "char", char: "A" }, action: "wosm.addProject.open", outcome: "handled", help: { keys: "A", label: "add" } },
    { id: "wosm.dashboard.collapse", pattern: { kind: "char", char: "C" }, action: "wosm.collapse.open", outcome: "handled", help: { keys: "C", label: "fold" } },
    { id: "wosm.dashboard.slotActivate", pattern: { kind: "slot" }, action: "wosm.row.activateSlot", outcome: "handled", help: slotHelp },
  ],
  help: [
    { id: "wosm.help.closeH", pattern: { kind: "char", char: "H" }, action: "wosm.help.close", outcome: "handled", help: { keys: "H/?/Q/esc", label: "close help" } },
    { id: "wosm.help.closeAlias", pattern: { kind: "char", char: "?" }, action: "wosm.help.close", outcome: "handled" },
    { id: "wosm.help.closeQ", pattern: { kind: "char", char: "Q" }, action: "wosm.help.close", outcome: "handled" },
    { id: "wosm.help.closeEsc", pattern: { kind: "named", named: "escape" }, action: "wosm.help.close", outcome: "handled" },
  ],
  search: [
    { id: "wosm.search.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.search.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.search.commit", pattern: { kind: "named", named: "return" }, action: "wosm.search.commit", outcome: "handled", help: { keys: "enter", label: "apply" } },
    { id: "wosm.search.deleteBack", pattern: { kind: "named", named: "backspace" }, action: "wosm.search.deleteChar", outcome: "handled" },
    { id: "wosm.search.deleteForward", pattern: { kind: "named", named: "delete" }, action: "wosm.search.deleteChar", outcome: "handled" },
    { id: "wosm.search.type", pattern: { kind: "text" }, action: "wosm.search.appendText", outcome: "handled" },
  ],
  projectCollapse: [
    { id: "wosm.collapse.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.collapse.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.collapse.toggleSlot", pattern: { kind: "slot" }, action: "wosm.collapse.toggleSlot", outcome: "handled", help: { keys: "1-9 a-z", label: "toggle project" } },
  ],
  removeChooseSlot: [
    { id: "wosm.remove.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.remove.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.remove.scrollUp", pattern: { kind: "named", named: "up" }, action: "wosm.view.scrollUp", outcome: "handled" },
    { id: "wosm.remove.scrollDown", pattern: { kind: "named", named: "down" }, action: "wosm.view.scrollDown", outcome: "handled" },
    { id: "wosm.remove.chooseSlot", pattern: { kind: "slot" }, action: "wosm.remove.chooseSlot", outcome: "handled", help: { keys: "1-9 a-z", label: "choose row" } },
  ],
  removeConfirm: [
    { id: "wosm.removeConfirm.cancelEsc", pattern: { kind: "named", named: "escape" }, action: "wosm.remove.cancel", outcome: "handled", help: { keys: "N/esc/enter", label: "cancel" } },
    { id: "wosm.removeConfirm.cancelEnter", pattern: { kind: "named", named: "return" }, action: "wosm.remove.cancel", outcome: "handled" },
    { id: "wosm.removeConfirm.cancelN", pattern: { kind: "char", char: "N" }, action: "wosm.remove.cancel", outcome: "handled" },
    { id: "wosm.removeConfirm.cancelLowerN", pattern: { kind: "char", char: "n" }, action: "wosm.remove.cancel", outcome: "handled" },
    { id: "wosm.removeConfirm.confirmY", pattern: { kind: "char", char: "Y" }, action: "wosm.remove.confirm", outcome: "handled", help: { keys: "Y", label: "confirm remove" } },
    { id: "wosm.removeConfirm.confirmLowerY", pattern: { kind: "char", char: "y" }, action: "wosm.remove.confirm", outcome: "handled" },
    // The confirm handler lowercases key.input without reading ctrl, so the
    // Ctrl-N/Ctrl-Y control bytes cancel/confirm too (upstream behavior).
    { id: "wosm.removeConfirm.cancelCtrlN", pattern: { kind: "char", char: "n", ctrl: true }, action: "wosm.remove.cancel", outcome: "handled" },
    { id: "wosm.removeConfirm.confirmCtrlY", pattern: { kind: "char", char: "y", ctrl: true }, action: "wosm.remove.confirm", outcome: "handled" },
  ],
  renameChooseSlot: [
    { id: "wosm.rename.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.rename.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.rename.scrollUp", pattern: { kind: "named", named: "up" }, action: "wosm.view.scrollUp", outcome: "handled" },
    { id: "wosm.rename.scrollDown", pattern: { kind: "named", named: "down" }, action: "wosm.view.scrollDown", outcome: "handled" },
    { id: "wosm.rename.chooseSlot", pattern: { kind: "slot" }, action: "wosm.rename.chooseSlot", outcome: "handled", help: { keys: "1-9 a-z", label: "choose row" } },
  ],
  renameEdit: [
    { id: "wosm.renameEdit.back", pattern: { kind: "named", named: "escape" }, action: "wosm.rename.back", outcome: "handled", help: { keys: "esc", label: "back" } },
    { id: "wosm.renameEdit.submit", pattern: { kind: "named", named: "return" }, action: "wosm.rename.submit", outcome: "handled", help: { keys: "enter", label: "rename" } },
    { id: "wosm.renameEdit.backspace", pattern: { kind: "named", named: "backspace" }, action: "wosm.rename.edit", outcome: "handled" },
    { id: "wosm.renameEdit.delete", pattern: { kind: "named", named: "delete" }, action: "wosm.rename.edit", outcome: "handled" },
    { id: "wosm.renameEdit.cursorLeft", pattern: { kind: "named", named: "left" }, action: "wosm.rename.edit", outcome: "handled" },
    { id: "wosm.renameEdit.cursorRight", pattern: { kind: "named", named: "right" }, action: "wosm.rename.edit", outcome: "handled" },
    { id: "wosm.renameEdit.type", pattern: { kind: "text" }, action: "wosm.rename.edit", outcome: "handled" },
  ],
  newSessionReview: [
    { id: "wosm.newSession.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.newSession.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.newSession.create", pattern: { kind: "named", named: "return" }, action: "wosm.newSession.submit", outcome: "handled", help: { keys: "enter", label: "create" } },
    { id: "wosm.newSession.editName", pattern: { kind: "char", char: "N" }, action: "wosm.newSession.editName", outcome: "handled", help: { keys: "N", label: "name" } },
    { id: "wosm.newSession.pickProject", pattern: { kind: "char", char: "P" }, action: "wosm.newSession.pickProject", outcome: "handled", help: { keys: "P", label: "project" } },
    { id: "wosm.newSession.pickAgent", pattern: { kind: "char", char: "A" }, action: "wosm.newSession.pickAgent", outcome: "handled", help: { keys: "A", label: "agent" } },
  ],
  newSessionEditName: [
    { id: "wosm.newSessionEdit.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.newSession.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.newSessionEdit.commit", pattern: { kind: "named", named: "return" }, action: "wosm.newSession.commitName", outcome: "handled", help: { keys: "enter", label: "use name" } },
    { id: "wosm.newSessionEdit.backspace", pattern: { kind: "named", named: "backspace" }, action: "wosm.newSession.editInput", outcome: "handled" },
    { id: "wosm.newSessionEdit.delete", pattern: { kind: "named", named: "delete" }, action: "wosm.newSession.editInput", outcome: "handled" },
    { id: "wosm.newSessionEdit.cursorLeft", pattern: { kind: "named", named: "left" }, action: "wosm.newSession.editInput", outcome: "handled" },
    { id: "wosm.newSessionEdit.cursorRight", pattern: { kind: "named", named: "right" }, action: "wosm.newSession.editInput", outcome: "handled" },
    { id: "wosm.newSessionEdit.type", pattern: { kind: "text" }, action: "wosm.newSession.editInput", outcome: "handled" },
  ],
  newSessionPickProject: [
    { id: "wosm.newSessionProject.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.newSession.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.newSessionProject.choose", pattern: { kind: "slot" }, action: "wosm.newSession.chooseProject", outcome: "handled", help: { keys: "1-9 a-z", label: "choose project" } },
  ],
  newSessionPickAgent: [
    { id: "wosm.newSessionAgent.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.newSession.cancel", outcome: "handled", help: { keys: "esc", label: "cancel" } },
    { id: "wosm.newSessionAgent.choose", pattern: { kind: "slot" }, action: "wosm.newSession.chooseAgent", outcome: "handled", help: { keys: "1-9 a-z", label: "choose agent" } },
  ],
  // The add-project flow has internal modes (start/choose/review/success/
  // failed, with a slash filter and a name editor); this single table covers
  // the union of its key vocabulary — the flow machine decides which apply
  // in the current sub-mode, exactly as upstream.
  addProject: [
    { id: "wosm.addProject.cancel", pattern: { kind: "named", named: "escape" }, action: "wosm.addProject.key", outcome: "handled", help: { keys: "esc", label: "back/cancel" } },
    { id: "wosm.addProject.confirm", pattern: { kind: "named", named: "return" }, action: "wosm.addProject.key", outcome: "handled", help: { keys: "enter", label: "confirm" } },
    { id: "wosm.addProject.up", pattern: { kind: "named", named: "up" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.down", pattern: { kind: "named", named: "down" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.left", pattern: { kind: "named", named: "left" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.right", pattern: { kind: "named", named: "right" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.backspace", pattern: { kind: "named", named: "backspace" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.delete", pattern: { kind: "named", named: "delete" }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.clearLine", pattern: { kind: "char", char: "u", ctrl: true }, action: "wosm.addProject.key", outcome: "handled" },
    { id: "wosm.addProject.type", pattern: { kind: "text" }, action: "wosm.addProject.key", outcome: "handled" },
  ],
};

/**
 * The help overlay's content, pinned to apps/tui's hardcoded list (the
 * upstream HelpOverlay's helpContent). Kept here so help copy lives beside
 * the bindings it documents; the coverage test asserts every dashboard
 * binding that carries help has a row, so a new chord cannot ship without
 * help text.
 */
export const WOSM_HELP_CONTENT = [
  { text: "wosm help", align: "center" as const },
  { text: "" },
  { key: "↑/↓ wheel", description: "scroll dashboard" },
  { key: "1-9/a-z", description: "choose visible item" },
  { key: "N", description: "new session" },
  { key: "R", description: "rename session" },
  { key: "X", description: "remove worktree" },
  { key: "C", description: "collapse project" },
  { key: "/", description: "search" },
  { key: "Z", description: "refresh snapshot" },
  { key: "H / ?", description: "help" },
  { key: "Q", description: "quit or close popup" },
  { key: "Esc", description: "back/cancel" },
] as const;

/**
 * Global bindings the transition machine handles before screen dispatch.
 * Ctrl-C in apps/tui exits the TUI with code 0; Station maps exit intent to
 * closing WOSM mode (the workspace owns process exit via Ctrl-Q).
 */
export const WOSM_GLOBAL_BINDINGS: readonly WosmBinding[] = [
  {
    id: "wosm.global.exitIntent",
    pattern: { kind: "char", char: "c", ctrl: true },
    action: "wosm.overlay.dismiss",
    outcome: "close-overlay",
  },
];

export function isSlotKey(key: TuiKey): boolean {
  // ctrl is not excluded: choice lookup in the machine reads key.input only,
  // so Ctrl-A activates slot "a" exactly as apps/tui does under Ink (the
  // global Ctrl-C binding resolves first).
  return (
    key.return !== true && key.escape !== true && SELECTION_KEYS.includes(key.input as SelectionKey)
  );
}

function matchesPattern(pattern: WosmKeyPattern, key: TuiKey): boolean {
  switch (pattern.kind) {
    case "char":
      return (
        key.input === pattern.char &&
        (pattern.ctrl === true) === (key.ctrl === true) &&
        key.return !== true &&
        key.escape !== true
      );
    case "named":
      switch (pattern.named) {
        case "return":
          return key.return === true || key.input === "\r" || key.input === "\n";
        case "escape":
          return key.escape === true;
        case "backspace":
          return key.backspace === true;
        case "delete":
          return key.delete === true;
        case "up":
          return key.upArrow === true;
        case "down":
          return key.downArrow === true;
        case "left":
          return key.leftArrow === true;
        case "right":
          return key.rightArrow === true;
      }
      return false;
    case "slot":
      return isSlotKey(key);
    case "text":
      // ctrl is deliberately NOT excluded: the ported text handlers read
      // key.input regardless of ctrl (Ctrl-U arrives as {input:"u", ctrl}
      // and inserts "u", exactly as apps/tui behaves under Ink). The global
      // Ctrl-C binding resolves first, so the escape hatch survives.
      return (
        key.input.length > 0 &&
        key.return !== true &&
        key.escape !== true &&
        key.backspace !== true &&
        key.delete !== true &&
        key.upArrow !== true &&
        key.downArrow !== true &&
        key.leftArrow !== true &&
        key.rightArrow !== true
      );
  }
}

/**
 * Resolves the binding for a key in a mode: globals first (mirroring the
 * machine's pre-screen Ctrl-C check), then the mode table in order. Specific
 * patterns are listed before the text catch-all in every table, so order is
 * the precedence rule.
 */
export function matchWosmBinding(mode: WosmInputMode, key: TuiKey): WosmBinding | undefined {
  for (const binding of WOSM_GLOBAL_BINDINGS) {
    if (matchesPattern(binding.pattern, key)) {
      return binding;
    }
  }
  for (const binding of WOSM_KEYMAP[mode]) {
    if (matchesPattern(binding.pattern, key)) {
      return binding;
    }
  }
  return undefined;
}
