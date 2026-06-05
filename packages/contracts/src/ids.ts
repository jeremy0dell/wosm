import { z } from "zod";
import { nonEmptyStringSchema } from "./shared.js";

export const WOSM_SCHEMA_VERSION = "0.4.0" as const;

const timestampSchema = z.string().datetime({ offset: true });
declare const wosmIdKind: unique symbol;

export type WosmId<TKind extends string> = string & {
  readonly [wosmIdKind]?: TKind;
};

function idSchema<TKind extends string>(): z.ZodType<WosmId<TKind>, string> {
  return nonEmptyStringSchema as z.ZodType<WosmId<TKind>, string>;
}

export const SchemaVersionSchema = z.literal(WOSM_SCHEMA_VERSION);

export const ProjectIdSchema = idSchema<"ProjectId">();
export const WorktreeIdSchema = idSchema<"WorktreeId">();
export const SessionIdSchema = idSchema<"SessionId">();
export const TerminalTargetIdSchema = idSchema<"TerminalTargetId">();
export const HarnessRunIdSchema = idSchema<"HarnessRunId">();
export const CommandIdSchema = idSchema<"CommandId">();
export const EventIdSchema = idSchema<"EventId">();
export const ProviderIdSchema = idSchema<"ProviderId">();
export const TimestampSchema = timestampSchema;

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type WorktreeId = z.infer<typeof WorktreeIdSchema>;
export type SessionId = z.infer<typeof SessionIdSchema>;
export type TerminalTargetId = z.infer<typeof TerminalTargetIdSchema>;
export type HarnessRunId = z.infer<typeof HarnessRunIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ProviderId = z.infer<typeof ProviderIdSchema>;
