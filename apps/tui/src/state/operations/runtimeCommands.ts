import type { TerminalFocusOrigin, WosmCommand } from "@wosm/contracts";

export type CommandRuntimeOptions = {
  persistentPopup: boolean;
  focusOrigin?: TerminalFocusOrigin;
  resolveFocusOrigin?: () => Promise<TerminalFocusOrigin | undefined>;
};

type CreateSessionCommand = Extract<WosmCommand, { type: "session.create" }>;
type StartAgentCommand = Extract<WosmCommand, { type: "session.startAgent" }>;
type RuntimeTerminalOptions = NonNullable<StartAgentCommand["payload"]["terminal"]>;

async function prepareCreateSessionCommandForRuntime(
  command: CreateSessionCommand,
  runtime: CommandRuntimeOptions,
): Promise<CreateSessionCommand> {
  if (!shouldFocusSessionCommand(runtime)) {
    return command;
  }

  const origin = await resolveFocusOrigin(runtime);
  return {
    ...command,
    payload: {
      ...command.payload,
      terminal: terminalWithRuntimeFocus(command.payload.terminal, origin),
    },
  };
}

async function prepareStartAgentCommandForRuntime(
  command: StartAgentCommand,
  runtime: CommandRuntimeOptions,
): Promise<StartAgentCommand> {
  if (!shouldFocusSessionCommand(runtime)) {
    return command;
  }

  const origin = await resolveFocusOrigin(runtime);
  return {
    ...command,
    payload: {
      ...command.payload,
      terminal: terminalWithRuntimeFocus(command.payload.terminal ?? {}, origin),
    },
  };
}

function terminalWithRuntimeFocus<TerminalOptions extends RuntimeTerminalOptions>(
  terminal: TerminalOptions,
  origin: TerminalFocusOrigin | undefined,
): TerminalOptions & { focus: true } {
  if (origin === undefined) {
    return {
      ...terminal,
      focus: true,
    };
  }
  return {
    ...terminal,
    focus: true,
    origin,
  };
}

function shouldFocusSessionCommand(runtime: CommandRuntimeOptions): boolean {
  return (
    runtime.persistentPopup ||
    runtime.focusOrigin !== undefined ||
    runtime.resolveFocusOrigin !== undefined
  );
}

async function resolveFocusOrigin(
  runtime: Pick<CommandRuntimeOptions, "focusOrigin" | "resolveFocusOrigin">,
): Promise<TerminalFocusOrigin | undefined> {
  if (runtime.resolveFocusOrigin === undefined) {
    return runtime.focusOrigin;
  }
  return (await runtime.resolveFocusOrigin()) ?? runtime.focusOrigin;
}

export async function prepareCommandForRuntime(
  command: WosmCommand,
  runtime: CommandRuntimeOptions,
): Promise<WosmCommand> {
  if (command.type === "session.create") {
    return prepareCreateSessionCommandForRuntime(command, runtime);
  }
  if (command.type === "session.startAgent") {
    return prepareStartAgentCommandForRuntime(command, runtime);
  }
  return command;
}

export async function withResolvedFocusOrigin(
  command: Extract<WosmCommand, { type: "terminal.focus" }>,
  runtime: Pick<CommandRuntimeOptions, "focusOrigin" | "resolveFocusOrigin">,
): Promise<Extract<WosmCommand, { type: "terminal.focus" }>> {
  const origin = await resolveFocusOrigin(runtime);
  if (origin === undefined) {
    return command;
  }
  return {
    type: "terminal.focus",
    payload: {
      ...command.payload,
      origin,
    },
  };
}
