// Translates the router's normalized legacy byte sequences into the ported
// machine's TuiKey vocabulary (apps/tui receives these pre-parsed from Ink;
// Station receives raw legacy bytes after reply-stripping and kitty
// translation). Full-sequence exact matching keeps bare Esc ("\x1b") and
// CSI-prefixed keys ("\x1b[A") distinct. Returns undefined for sequences the
// dashboard has no vocabulary for (F-keys, unknown CSI) — the overlay layer
// swallows those without dispatching, so stray escape sequences can never
// leak into text-input modes as garbage characters.
import type { TuiKey } from "../ported/state/keys.js";

const NAMED_SEQUENCES: Record<string, TuiKey> = {
  "\r": { input: "\r", return: true },
  "\n": { input: "\n", return: true },
  "\x1b": { input: "", escape: true },
  "\x7f": { input: "", backspace: true },
  "\b": { input: "", backspace: true },
  "\x1b[3~": { input: "", delete: true },
  "\x1b[A": { input: "", upArrow: true },
  "\x1b[B": { input: "", downArrow: true },
  "\x1b[C": { input: "", rightArrow: true },
  "\x1b[D": { input: "", leftArrow: true },
  // Application cursor mode (DECCKM) variants.
  "\x1bOA": { input: "", upArrow: true },
  "\x1bOB": { input: "", downArrow: true },
  "\x1bOC": { input: "", rightArrow: true },
  "\x1bOD": { input: "", leftArrow: true },
};

export function sequenceToTuiKey(sequence: string): TuiKey | undefined {
  const named = NAMED_SEQUENCES[sequence];
  if (named !== undefined) {
    return { ...named };
  }

  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    // Control bytes map to ctrl+letter (Ctrl-C = \x03 -> {input:"c", ctrl}).
    // \t (Ctrl-I), \r/\n, and \x1b are named above or deliberately absent;
    // legacy encoding cannot distinguish Tab from Ctrl-I, and the dashboard
    // binds neither.
    if (code >= 0x01 && code <= 0x1a) {
      return { input: String.fromCharCode(code + 0x60), ctrl: true };
    }
    if (code < 0x20) {
      return undefined;
    }
  }

  if (containsControlBytes(sequence)) {
    return undefined;
  }

  return { input: sequence };
}

function containsControlBytes(sequence: string): boolean {
  for (const char of sequence) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Paste arrives as a raw decoded chunk, not a key sequence, so it bypasses
 * the translation above — this applies the same control-byte discipline to
 * that channel: newlines flatten to spaces (the ported text handlers are
 * single-line), every other control byte is dropped. Without this, a pasted
 * blob could inject the very escape garbage the key path promises to keep
 * out of text inputs.
 */
export function sanitizePastedText(text: string): string {
  let sanitized = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) {
      sanitized += " ";
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    sanitized += char;
  }
  return sanitized;
}
