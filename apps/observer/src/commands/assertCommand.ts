import type { WosmCommand } from "@wosm/contracts";
import type { CommandHandlerContext } from "./queue.js";

export function assertCommandType<TType extends WosmCommand["type"]>(
  context: CommandHandlerContext,
  type: TType,
): asserts context is CommandHandlerContext & {
  command: Extract<WosmCommand, { type: TType }>;
} {
  if (context.command.type !== type) {
    throw new Error(`Expected ${type} command, received ${context.command.type}.`);
  }
}
