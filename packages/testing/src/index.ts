export type FakeProviderTestkitPlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly providers: readonly string[];
};

export type ScriptedAgentLifecyclePlaceholder = {
  readonly phase: "0";
  readonly status: "placeholder";
  readonly states: readonly string[];
};

export function createFakeProviderTestkitPlaceholder(): FakeProviderTestkitPlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    providers: ["fake-worktree", "fake-terminal", "fake-harness"],
  };
}

export function createScriptedAgentLifecyclePlaceholder(): ScriptedAgentLifecyclePlaceholder {
  return {
    phase: "0",
    status: "placeholder",
    states: ["defined", "started", "stopped"],
  };
}
