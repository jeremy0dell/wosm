# Tmux Popup Readability Refactor Plan

Status: implemented in `plan/tmux-popup-readability`.

## Problem

`integrations/terminal/tmux/src/popup.ts` is a god file. It currently owns popup argument
construction, persistent UI sessions, registered dev popup lookup, active/focus tmux option state,
workbench bootstrap/focus, tmux command wrapping, shell command assembly, and several unrelated
private helpers.

The file is also written in a public-entrypoint-first style: exported functions appear near the top
and most implementation details appear afterward. A source-order lint experiment flagged 41
violations in this file alone under the preferred convention:

```text
imports
public type contracts, unless schema-derived
private types
schemas and constants
private helpers
exported runtime functions
```

The source-order issue is a symptom. The deeper problem is that the popup boundary has too many
responsibilities and too many ad hoc local patterns.

## Goals

- Split the tmux popup implementation into a `popup/` directory with narrow modules.
- Preserve the current public `@wosm/tmux` API during the refactor unless a deliberate compatibility
  shim is included.
- Replace dense conditional object spreads in complex builders with typed local builders and explicit
  `if` assignments.
- Remove duplicated tmux command/error wrapping and centralize popup command execution.
- Avoid JavaScript-style `unknown` probing such as repeated `typeof value === "object"`,
  `"key" in value`, and local shape casts when a typed runtime boundary or strict parser can own the
  shape.
- Express expected external-command behavior through typed runtime options, for example
  `allowedExitCodes`, rather than detecting expected outcomes by inspecting an arbitrary caught
  object.
- Use WOSM SafeError/runtime helpers at IO boundaries and keep tmux-specific error normalization
  behind the tmux integration boundary.
- Add a scoped source-order lint guard for the new popup modules before enabling it more broadly.

## Non-Goals

- Do not move tmux-specific popup option names into `packages/contracts`.
- Do not make a whole-repo source-order migration in this slice.
- Do not change the user-facing popup behavior unless an existing test proves the current behavior is
  wrong.
- Do not rewrite terminal provider topology or general tmux provider discovery.

## Boundary Decisions

Most popup types and constants should remain provider-private.

Keep inside `integrations/terminal/tmux`:

- tmux global option names such as `@wosm_popup_client` and `@wosm_popup_focus_client`
- persistent `_wosm-ui` session details
- registered dev popup tmux option keys
- tmux shell quoting and `display-popup` command assembly
- tmux workbench bootstrap/focus behavior

Do not move these to `packages/contracts` unless they become provider-neutral protocol payloads or
observer snapshot fields.

The exported package surface can keep these names for compatibility:

```ts
buildTmuxPopupArgs
openTmuxPopup
ensurePersistentPopupSession
resolveRegisteredDevPopupUi
resolveTmuxPopupFocusOrigin
dismissTmuxPopup
TmuxPopupOptions
TmuxPopupResult
TmuxPopupDismissResult
TmuxPersistentPopupSessionResult
TmuxRegisteredDevPopupUi
```

Internally, split broad option shapes into narrower module-local inputs. For example:

```ts
type TmuxPopupRuntimeDeps = {
  command: string;
  runner?: ExternalCommandRunner;
  timeoutMs?: number;
};

type PopupFocusInput = TmuxPopupRuntimeDeps & {
  env: Record<string, string | undefined>;
  focusClientId?: string;
};
```

The public `TmuxPopupOptions` can remain as a facade type while internal modules consume focused
types.

## Target Module Shape

Create a `popup/` directory and keep `src/popup.ts` as a small compatibility facade if direct
internal test imports still depend on that path.

```text
integrations/terminal/tmux/src/popup.ts
integrations/terminal/tmux/src/popup/index.ts
integrations/terminal/tmux/src/popup/types.ts
integrations/terminal/tmux/src/popup/constants.ts
integrations/terminal/tmux/src/popup/args.ts
integrations/terminal/tmux/src/popup/state.ts
integrations/terminal/tmux/src/popup/persistentUi.ts
integrations/terminal/tmux/src/popup/workbenchFocus.ts
integrations/terminal/tmux/src/popup/command.ts
```

Responsibilities:

- `popup.ts`: re-export facade only.
- `popup/index.ts`: public popup API composition.
- `popup/types.ts`: public facade types plus internal focused input types.
- `popup/constants.ts`: tmux option keys and default persistent popup command/session names.
- `popup/args.ts`: `display-popup` args, popup shell command assembly, cleanup shell generation.
- `popup/state.ts`: active/focus popup client option reads/writes/clears.
- `popup/persistentUi.ts`: `_wosm-ui` session creation, signature handling, registered dev popup
  lookup.
- `popup/workbenchFocus.ts`: workbench session creation/configuration and client/window/pane focus.
- `popup/command.ts`: popup-specific tmux command/query wrappers and SafeError mapping.

## Source Order Rule

New popup modules should be written in this order:

```text
1. imports
2. public type contracts, unless schema-derived
3. private types
4. schemas and constants
5. private helpers and typed builders
6. exported runtime functions/classes
```

Within a file, helpers should be placed close to the exported function they support when that does not
violate the top-level order. If a helper becomes shared by multiple popup modules, move it to the
smallest appropriate popup module instead of leaving a generic helper cluster in `index.ts`.

## Lint Guard

Add the source-order guard only after the popup directory has been split and written in the target
order.

Preferred implementation path:

1. Start with a scoped rule that applies only to `integrations/terminal/tmux/src/popup/**/*.ts` and
   the tiny `src/popup.ts` facade.
2. Use a small repo-local TypeScript AST checker scoped to the popup directory. Do not enable it
   globally.
4. Add the rule to the deterministic lint path only after the popup modules pass it.

The rule should not sort code alphabetically. It should report structural order violations only.

## Refactor Steps

### 1. Characterize Current Behavior

- Run the existing popup unit tests before moving code.
- Capture the current public exports and test imports.
- Record the current `buildTmuxPopupArgs()` output for persistent and non-persistent paths.

Expected focused checks:

```bash
pnpm test:unit -- integrations/terminal/tmux/test/unit/popup.test.ts
pnpm --filter @wosm/tmux typecheck
```

### 2. Extract Types And Constants

- Move popup option/result types into `popup/types.ts`.
- Move tmux option keys and defaults into `popup/constants.ts`.
- Keep `TmuxPopupOptions` exported for current CLI/tests.
- Introduce narrower internal input types for command deps, focus resolution, persistent UI, and
  popup state.

Avoid:

```ts
Pick<TmuxPopupOptions, "...many fields...">
```

when a named internal type communicates the actual dependency.

### 3. Extract Command And Error Boundary

- Move popup tmux command/query wrappers into `popup/command.ts`.
- Reuse `runTmuxCommand` and `tryRunTmuxCommand`.
- Keep tmux provider error normalization in the tmux integration boundary.
- Replace expected popup-dismiss handling with typed external-command behavior.

Preferred shape:

```ts
const result = await runExternalCommand({
  command,
  args,
  signal,
  maxOutputChars: 64 * 1024,
  allowedExitCodes: [0, 129],
});
```

Then map exit code `129` through a typed local result, not by probing `unknown`:

```ts
type PopupDisplayResult = "opened" | "dismissed";
```

If a new runtime helper is needed, add it in `@wosm/runtime` once and reuse it. Do not add repeated
local object-probing helpers.

### 4. Extract Args And Shell Assembly

- Move `buildTmuxPopupArgs`, popup TUI command building, persistent attach command building, cleanup
  script building, and shell quoting helpers into `popup/args.ts`.
- Remove no-op aliases such as `quoteEnvValue()` unless they carry domain meaning.
- Keep shell escaping centralized and covered by focused tests.

Rewrite complex object creation as typed builders. For example, replace dense conditional spreads
with:

```ts
const input: BuildTmuxPopupArgsOptions = {
  command,
  persistent,
};

if (config !== undefined) {
  input.config = config;
}
if (focusClientId !== undefined) {
  input.focusClientId = focusClientId;
  input.popupState = popupStateForClient(focusClientId, command);
}
```

### 5. Extract State And Persistent UI

- Move active/focus popup client reads/writes/clears into `popup/state.ts`.
- Move persistent session signature, `_wosm-ui` creation/replacement, and registered dev popup
  lookup into `popup/persistentUi.ts`.
- Use named builders for result objects where optional `owner` and `root` fields are conditionally
  present. Preserve absent-vs-undefined semantics.
- Centralize owner liveness checks. If checking Node error codes remains necessary, use one small
  runtime helper or one provider-local helper with a clear boundary comment.

### 6. Extract Workbench Focus

- Move `enterWorkbenchForPopup`, workbench session creation/configuration, live agent pane lookup,
  first window lookup, and client/window/pane switching into `popup/workbenchFocus.ts`.
- Keep tmux target mechanics provider-private.
- Do not leak tmux pane/window ids into shared contracts unless a later provider-neutral focus
  contract requires them.

### 7. Rebuild Public Facade

- Make `popup/index.ts` compose the extracted modules.
- Keep `src/popup.ts` as:

```ts
export * from "./popup/index.js";
```

- Update `src/index.ts` only if needed.
- Keep tests importing either `@wosm/tmux` or the facade path until a separate test-boundary cleanup.

### 8. Add Scoped Lint

- Add the source-order lint guard scoped to the new popup modules.
- Run it before adding it to the main lint path.
- Only then wire it into `pnpm lint` or the narrow tmux package lint path.

## Code Quality Rules For This Slice

- No broad local helper clusters such as `isRecord`, `stringField`, or repeated `"key" in value`
  checks.
- Use strict schemas only for untrusted structured input. Do not add schemas for already-typed local
  objects.
- Use typed local builders for complex optional object construction.
- Prefer discriminated unions and explicit result types over stringly status checks.
- Keep provider-specific diagnostics and tmux behavior inside `integrations/terminal/tmux`.
- Do not use `...(await somePromise)` in object or array construction.
- Do not change behavior and refactor structure in the same commit unless a test requires it.

## Verification

Focused deterministic checks:

```bash
pnpm --filter @wosm/tmux typecheck
pnpm test:unit -- integrations/terminal/tmux/test/unit/popup.test.ts
pnpm test:unit -- apps/cli/test/integration/popup-command.test.ts
pnpm lint
```

Broader gate before merge:

```bash
pnpm test:all
```

Optional real tmux lane when popup behavior changes:

```bash
WOSM_REAL_TMUX=1 pnpm test:unit -- integrations/terminal/tmux/test/integration/popup-real.test.ts
```

Manual UX verification:

```bash
pnpm wosm:reset
pnpm wosm
```

Expected UX: opening the popup still toggles correctly, persistent popup reuse still works, and a
popup row focus still lands the user in the selected workbench pane without leaving stale popup tmux
state behind.

## Completion Criteria

- `popup.ts` is a facade or very small public composer, not an 800+ line god file.
- Popup implementation modules pass the source-order lint guard.
- Dense conditional-spread builders in popup code are replaced with typed explicit builders.
- Expected popup dismissal does not rely on probing an `unknown` error object.
- Tmux option identity, persistent UI identity, and workbench focus logic each live in their own
  module.
- Existing popup unit tests pass with behavior unchanged.
- Manual popup open/toggle/focus behavior is verified.
