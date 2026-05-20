export type DebugBundlePlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly sections: readonly string[];
};

export function createDebugBundlePlaceholder(): DebugBundlePlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    sections: ["manifest", "config-summary", "health", "redaction-report"],
  };
}
