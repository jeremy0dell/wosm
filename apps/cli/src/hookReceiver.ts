/**
 * @deprecated Import hook receiver contracts from `@wosm/hook-bridge`. This CLI
 * re-export remains only for older internal callers.
 */
export type { HookReceiverDeps, HookReceiverInput } from "@wosm/hook-bridge";
/**
 * @deprecated Import `receiveHookEvent` from `@wosm/hook-bridge`. Runtime hooks
 * should enter through `wosm-hook` or an equivalent hook-bridge client.
 */
export { receiveHookEvent } from "@wosm/hook-bridge";
