# TypeScript Shape Boundary Audit

Use this as the brief for one-off audits that look for JavaScript-style runtime shape probing where idiomatic TypeScript or Zod should own the data shape.

This is not a mandate to remove every `typeof`, `Array.isArray`, or `"key" in value`. Those are valid at real dynamic boundaries. The audit target is code that keeps treating data as loose JavaScript objects after it has already crossed a typed boundary, or that hand-maintains a validator next to a schema that should be authoritative.

## Plain Anti-Pattern

The anti-pattern is treating already-typed application state as untrusted dictionaries.

Smelly shape:

```ts
const record = isRecord(value) ? value : {};
const id = stringField(record, "id");
if ("status" in record && typeof record.status === "string") {
  // ...
}
```

Better shape:

```ts
const parsed = PayloadSchema.parse(value);
switch (parsed.type) {
  // exhaustive typed handling
}
```

Or, for already-typed inputs:

```ts
switch (command.type) {
  case "session.startAgent":
    return `session:${command.payload.sessionId}`;
}
```

## Rules For Audits

1. Boundary first: `unknown` should appear at JSON, TOML, CLI output, hook, provider, persistence JSON, protocol, and error-normalization boundaries. It should be parsed or normalized there, then typed data should move inward.

2. Prefer schemas over helper clusters: do not add local clusters like `isRecord`, `asRecord`, `stringField`, `numberField`, `booleanField`, `ownerLogin`, or `repositoryNameWithOwner` when a Zod schema, contract parser, or discriminated union should own the shape.

3. One shape, one authority: if a shared payload has a shape, define the schema in `packages/contracts` and infer the TS type from it. If the shape is provider-private, keep the schema beside that provider's adapter/parser.

4. Do not duplicate schemas by hand: a local helper that checks the same fields as an existing schema is a bug magnet. Replace it with `schema.safeParse`, `schema.parse`, or a typed mapper fed by schema output.

5. Internal code should use TS narrowing: once the input is `WosmCommand`, `HarnessEventReport`, `WorktreeObservation`, etc., prefer discriminated unions, exhaustive `switch`, typed builders, and normal property access.

6. Keep generic probing generic: `typeof`, `Array.isArray`, and record traversal are acceptable for redaction, generic JSON traversal, error normalization, and the first step before schema parsing. Keep that probing small and local.

7. Do not scrape providerData in core: observer/core/TUI code should not know that Codex uses `turn_id` while Pi uses `turnIndex`. Normalize correlation and status fields at the provider boundary, or parse provider-private `providerData` behind a provider-owned schema.

8. Preserve optional semantics: keep `exactOptionalPropertyTypes` behavior. Use typed local builders with explicit `if` assignments for complex optional output instead of dense object-spread puzzles.

## Audit Surfaces

Check these surfaces separately so findings stay actionable:

- Contracts and protocol: `packages/contracts`, `packages/protocol`
- Observer core: commands, hooks, persistence, reconcile, runtime
- CLI command parsing and debug output
- TUI service/reducer paths, especially boundary data from observer
- Runtime and observability error/redaction paths
- Config loading and normalization
- Harness integrations: Codex, Pi, OpenCode, scripted
- Terminal integration: tmux provider, parser, popup paths
- Worktree integration: Worktrunk provider, parser, hook editor, metadata
- Repository integration: GitHub provider JSON/error parsing
- Test support helpers only when they shape production fixtures or hide contract drift

## Finding Format

For each finding, include:

- File and line.
- Whether the code is at a real dynamic boundary or inside typed application code.
- Existing authoritative type or schema, if one exists.
- Minimal fix: use an existing schema, add a provider-local schema, move a shared schema to `packages/contracts`, or switch to typed/exhaustive handling.
- Risk: provider boundary leak, schema drift, silent malformed data, optional-field bug, or readability/maintainability only.

## High-Signal Searches

Start with these searches, then inspect context manually:

```sh
rg -n "function (isRecord|asRecord|stringField|numberField|booleanField)|typeof .*===|typeof .*!==|Array\\.isArray|\\\"[A-Za-z0-9_]+\\\" in |as Record<string, unknown>" apps packages integrations --glob '*.ts'
rg -n "providerData|safeParse|JSON\\.parse|schema\\.parse|discriminatedUnion" apps packages integrations --glob '*.ts'
```

Search results are not findings by themselves. Classify each hit as boundary-valid, typed-code smell, schema duplication, or provider boundary leak.

## Current Known Examples

- `apps/observer/src/commands/queue.ts`: command scope uses payload key probing even though `WosmCommand` is a discriminated union.
- `apps/observer/src/hooks/harnessIngressQueue.ts`: coalescing scrapes provider-specific turn/tool keys from generic `providerData`.
- `packages/provider-hooks/src/sender.ts`: ownership checks use redundant `typeof stringField(...) === "string"` after a helper already narrowed the field.
- `integrations/harness/pi/src/piExtension.ts`: compact event extraction is a large manual `unknown` mapper adjacent to Pi event schemas.
- `integrations/worktree/worktrunk/src/parse.ts`: flexible Worktrunk output normalization should be reviewed for schema/preprocess ownership.
- `integrations/repository/github/src/provider.ts`: GitHub schema-backed CLI parsing sits next to local hand-written error/repository shape helpers.

## Done Criteria

The audit is done when each surface has been classified, the real smells have minimal fixes proposed, and accepted dynamic-boundary probing has been explicitly left alone.

Do not convert legitimate generic traversal into overbuilt schemas. The point is to move shape knowledge to the right boundary, not to make TypeScript ceremonial.
