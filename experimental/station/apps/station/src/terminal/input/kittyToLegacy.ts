// Station's outer terminal may have the kitty keyboard protocol active (the
// OpenTUI renderer enables it), but pane children that never opted in still
// expect legacy bytes: forwarding `\x1b[99;5u` instead of `\x03` breaks
// Ctrl-C, Esc, and friends inside every pane. This is a best-effort
// de-escalation of kitty CSI-u sequences to the bytes a legacy terminal
// would have sent.

const CSI_U_PATTERN = /^\x1b\[([0-9:]+)(?:;([0-9:]+))?u$/;

const KITTY_SHIFT = 1;
const KITTY_ALT = 2;
const KITTY_CTRL = 4;

const KEY_ESCAPE = 27;
const KEY_ENTER = 13;
const KEY_TAB = 9;
const KEY_BACKSPACE = 127;
const KEY_SPACE = 32;
const RELEASE_EVENT = 3;

/**
 * Translates a kitty-protocol CSI-u key sequence into the legacy byte string
 * a non-kitty terminal would send. Non-CSI-u sequences pass through
 * unchanged; key-release events translate to "" (drop, do not forward).
 */
export function kittySequenceToLegacy(sequence: string): string {
  const match = CSI_U_PATTERN.exec(sequence);
  if (match === null) {
    return sequence;
  }

  const codeField = match[1] ?? "";
  const modifierField = match[2] ?? "1";
  const codeParts = codeField.split(":");
  const modifierParts = modifierField.split(":");

  const codePoint = Number.parseInt(codeParts[0] ?? "", 10);
  const modifierValue = Number.parseInt(modifierParts[0] ?? "1", 10);
  const eventType = Number.parseInt(modifierParts[1] ?? "1", 10);
  if (!Number.isFinite(codePoint)) {
    return sequence;
  }
  if (eventType === RELEASE_EVENT) {
    return "";
  }

  const modifiers = (Number.isFinite(modifierValue) ? modifierValue : 1) - 1;
  const shift = (modifiers & KITTY_SHIFT) !== 0;
  const alt = (modifiers & KITTY_ALT) !== 0;
  const ctrl = (modifiers & KITTY_CTRL) !== 0;

  const base = legacyBaseBytes(codePoint, codeParts, { shift, ctrl });
  if (base === undefined) {
    // Unknown functional key: dropping it beats leaking CSI-u bytes into a
    // child that will render them as garbage input.
    return "";
  }
  return alt ? `\x1b${base}` : base;
}

function legacyBaseBytes(
  codePoint: number,
  codeParts: string[],
  state: { shift: boolean; ctrl: boolean },
): string | undefined {
  switch (codePoint) {
    case KEY_ESCAPE:
      return "\x1b";
    case KEY_ENTER:
      return "\r";
    case KEY_TAB:
      return state.shift ? "\x1b[Z" : "\t";
    case KEY_BACKSPACE:
      return state.ctrl ? "\x08" : "\x7f";
    case KEY_SPACE:
      return state.ctrl ? "\x00" : " ";
    default:
      break;
  }

  if (state.ctrl) {
    const control = controlByteFor(codePoint);
    if (control !== undefined) {
      return control;
    }
  }

  // Kitty encodes functional keys in the Unicode private-use area. Keypad
  // keys have direct legacy equivalents (a numpad Enter must type Enter);
  // the rest (F-keys, media keys, modifiers-as-keys) are dropped.
  const keypad = KEYPAD_LEGACY.get(codePoint);
  if (keypad !== undefined) {
    return keypad;
  }
  if (codePoint >= 0xe000 && codePoint <= 0xf8ff) {
    return undefined;
  }
  // Malformed sequences can carry fields beyond the Unicode range;
  // String.fromCodePoint would throw inside the input dispatch path.
  if (codePoint > 0x10ffff) {
    return undefined;
  }

  if (codePoint >= 0x20 && codePoint !== KEY_BACKSPACE) {
    // With shift, kitty reports the shifted character as the first alternate
    // (`code:shifted`); prefer it so Shift+1 emits "!" not "1".
    if (state.shift && codeParts.length > 1) {
      const shifted = Number.parseInt(codeParts[1] ?? "", 10);
      if (Number.isFinite(shifted) && shifted >= 0x20 && shifted <= 0x10ffff) {
        return String.fromCodePoint(shifted);
      }
    }
    return String.fromCodePoint(codePoint);
  }

  return undefined;
}

// Kitty keypad PUA assignments -> the bytes a legacy terminal sends.
const KEYPAD_LEGACY = new Map<number, string>([
  [57399, "0"],
  [57400, "1"],
  [57401, "2"],
  [57402, "3"],
  [57403, "4"],
  [57404, "5"],
  [57405, "6"],
  [57406, "7"],
  [57407, "8"],
  [57408, "9"],
  [57409, "."],
  [57410, "/"],
  [57411, "*"],
  [57412, "-"],
  [57413, "+"],
  [57414, "\r"], // keypad Enter
  [57415, "="],
  [57417, "\x1b[D"], // keypad left
  [57418, "\x1b[C"], // keypad right
  [57419, "\x1b[A"], // keypad up
  [57420, "\x1b[B"], // keypad down
  [57421, "\x1b[5~"], // keypad page up
  [57422, "\x1b[6~"], // keypad page down
  [57423, "\x1b[H"], // keypad home
  [57424, "\x1b[F"], // keypad end
  [57425, "\x1b[2~"], // keypad insert
  [57426, "\x1b[3~"], // keypad delete
]);

function controlByteFor(codePoint: number): string | undefined {
  // Ctrl+a..z -> 0x01..0x1a
  if (codePoint >= 0x61 && codePoint <= 0x7a) {
    return String.fromCharCode(codePoint - 0x60);
  }
  // Ctrl+A..Z (shift held) -> same control bytes
  if (codePoint >= 0x41 && codePoint <= 0x5a) {
    return String.fromCharCode(codePoint - 0x40);
  }
  // Ctrl+@ [ \ ] ^ _ -> 0x00, 0x1b..0x1f
  if (codePoint === 0x40 || (codePoint >= 0x5b && codePoint <= 0x5f)) {
    return String.fromCharCode(codePoint - 0x40);
  }
  // xterm legacy quirks for the remaining punctuation/digit chords.
  switch (codePoint) {
    case 0x2f: // Ctrl+/
      return "\x1f";
    case 0x3f: // Ctrl+?
      return "\x7f";
    case 0x32: // Ctrl+2
      return "\x00";
    case 0x33: // Ctrl+3
      return "\x1b";
    case 0x34: // Ctrl+4
      return "\x1c";
    case 0x35: // Ctrl+5
      return "\x1d";
    case 0x36: // Ctrl+6
      return "\x1e";
    case 0x37: // Ctrl+7
      return "\x1f";
    case 0x38: // Ctrl+8
      return "\x7f";
    default:
      return undefined;
  }
}
