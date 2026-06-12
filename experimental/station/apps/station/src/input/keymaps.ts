import type { StationState } from "../state/types.js";

export type LayerId =
  | "resize-drag"
  | "dialog"
  | "command-palette"
  | "overlay"
  | "terminal"
  | "workspace"
  | "base";

/**
 * The documented priority order, highest first. All seven slots are named so
 * a future layer is a registration into an existing slot; only layers that
 * are actually registered participate in resolution.
 */
export const LAYER_PRIORITY: readonly LayerId[] = [
  "resize-drag",
  "dialog",
  "command-palette",
  "overlay",
  "terminal",
  "workspace",
  "base",
];

export type KeyBinding<TOutcome> = {
  /**
   * Legacy byte forms only; kitty CSI-u sequences are normalized to legacy
   * bytes before routing. Never bind collision bytes that legacy encoding
   * cannot distinguish (Tab=Ctrl-I \x09, Enter=Ctrl-M \x0d, Esc=Ctrl-[
   * \x1b). When a future phase needs chords legacy bytes cannot express
   * (modified F-keys, Ctrl+Shift distinctions), the binding key becomes a
   * normalized key descriptor - the registration shape stays the same.
   */
  keys: readonly string[];
  /**
   * Reserved keys may not be consumed by any layer's catch-all; they fall
   * through to the layer that explicitly binds them. This is how Ctrl-Q and
   * Ctrl-O survive both the terminal passthrough and the overlay swallow
   * despite being registered in the lower-priority workspace layer. An
   * explicit binding in a higher layer still wins.
   */
  reserved?: boolean;
  action: (state: StationState) => TOutcome;
};

export type KeymapLayer<TOutcome> = {
  id: LayerId;
  isActive(state: StationState): boolean;
  bindings: readonly KeyBinding<TOutcome>[];
  /** Modal swallow or terminal passthrough: claims every non-reserved key. */
  catchAll?: (key: string, state: StationState) => TOutcome;
};

export type KeymapStack<TOutcome> = {
  layers: readonly KeymapLayer<TOutcome>[];
  reservedKeys: ReadonlySet<string>;
  /** Returns undefined when no active layer claims the key. */
  resolve(key: string, state: StationState): TOutcome | undefined;
};

export function createKeymapStack<TOutcome>(
  layers: readonly KeymapLayer<TOutcome>[],
): KeymapStack<TOutcome> {
  const ordered = [...layers].sort(
    (a, b) => LAYER_PRIORITY.indexOf(a.id) - LAYER_PRIORITY.indexOf(b.id),
  );

  const reservedKeys = new Set<string>();
  const keyIndexes = new Map<LayerId, Map<string, KeyBinding<TOutcome>>>();
  for (const layer of ordered) {
    if (keyIndexes.has(layer.id)) {
      throw new Error(`duplicate keymap layer: ${layer.id}`);
    }
    const index = new Map<string, KeyBinding<TOutcome>>();
    for (const binding of layer.bindings) {
      for (const key of binding.keys) {
        if (index.has(key)) {
          throw new Error(`duplicate key binding in layer ${layer.id}: ${JSON.stringify(key)}`);
        }
        index.set(key, binding);
        if (binding.reserved === true) {
          reservedKeys.add(key);
        }
      }
    }
    keyIndexes.set(layer.id, index);
  }

  return {
    layers: ordered,
    reservedKeys,
    resolve(key, state) {
      for (const layer of ordered) {
        if (!layer.isActive(state)) {
          continue;
        }
        const binding = keyIndexes.get(layer.id)?.get(key);
        if (binding !== undefined) {
          return binding.action(state);
        }
        if (layer.catchAll !== undefined && !reservedKeys.has(key)) {
          return layer.catchAll(key, state);
        }
      }
      return undefined;
    },
  };
}
