import type { DatabaseSync } from "node:sqlite";
import type { CommandId, ErrorEnvelope, SafeError, WosmCommand } from "@wosm/contracts";
import { ErrorEnvelopeSchema, SafeErrorSchema, WosmCommandSchema } from "@wosm/contracts";
import { stringifyJson } from "./json";
import { type CommandErrorRow, type CommandRow, commandErrorFromRow, commandFromRow } from "./rows";
import type { PersistedCommand, PersistedCommandError } from "./types";

export function recordCommandAccepted(
  database: DatabaseSync,
  input: { commandId: CommandId; command: WosmCommand; createdAt: string },
): PersistedCommand {
  const command = WosmCommandSchema.parse(input.command);
  database
    .prepare(
      `
        INSERT INTO commands (id, type, payload_json, status, created_at)
        VALUES (?, ?, ?, 'accepted', ?)
      `,
    )
    .run(input.commandId, command.type, stringifyJson(command), input.createdAt);
  return readCommand(database, input.commandId);
}

export function markCommandStarted(
  database: DatabaseSync,
  commandId: CommandId,
  startedAt: string,
): PersistedCommand {
  database
    .prepare("UPDATE commands SET status = 'started', started_at = ? WHERE id = ?")
    .run(startedAt, commandId);
  return readCommand(database, commandId);
}

export function markCommandSucceeded(
  database: DatabaseSync,
  commandId: CommandId,
  finishedAt: string,
): PersistedCommand {
  database
    .prepare(
      "UPDATE commands SET status = 'succeeded', finished_at = ?, error_json = NULL WHERE id = ?",
    )
    .run(finishedAt, commandId);
  return readCommand(database, commandId);
}

export function markCommandFailed(
  database: DatabaseSync,
  input: {
    commandId: CommandId;
    safeError: SafeError;
    envelope: ErrorEnvelope;
    finishedAt: string;
  },
): PersistedCommand {
  const safeError = SafeErrorSchema.parse(input.safeError);
  const envelope = ErrorEnvelopeSchema.parse(input.envelope);
  database
    .prepare("UPDATE commands SET status = 'failed', finished_at = ?, error_json = ? WHERE id = ?")
    .run(input.finishedAt, stringifyJson(safeError), input.commandId);
  database
    .prepare(
      `
        INSERT OR REPLACE INTO command_errors (id, command_id, envelope_json, created_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(envelope.id, input.commandId, stringifyJson(envelope), envelope.createdAt);
  return readCommand(database, input.commandId);
}

export function getCommand(
  database: DatabaseSync,
  commandId: CommandId,
): PersistedCommand | undefined {
  const row = getCommandRow(database, commandId);
  return row === undefined ? undefined : commandFromRow(row);
}

export function listCommands(database: DatabaseSync): PersistedCommand[] {
  return (
    database.prepare("SELECT * FROM commands ORDER BY created_at, id").all() as CommandRow[]
  ).map(commandFromRow);
}

export function listCommandErrors(
  database: DatabaseSync,
  commandId?: CommandId,
): PersistedCommandError[] {
  const rows =
    commandId === undefined
      ? (database
          .prepare("SELECT * FROM command_errors ORDER BY created_at, id")
          .all() as CommandErrorRow[])
      : (database
          .prepare("SELECT * FROM command_errors WHERE command_id = ? ORDER BY created_at, id")
          .all(commandId) as CommandErrorRow[]);
  return rows.map(commandErrorFromRow);
}

function readCommand(database: DatabaseSync, commandId: string): PersistedCommand {
  const row = getCommandRow(database, commandId);
  if (row === undefined) {
    throw new Error(`Command ${commandId} was not found.`);
  }
  return commandFromRow(row);
}

function getCommandRow(database: DatabaseSync, commandId: string): CommandRow | undefined {
  return database.prepare("SELECT * FROM commands WHERE id = ?").get(commandId) as
    | CommandRow
    | undefined;
}
