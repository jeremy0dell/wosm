import type { HarnessProvider, SafeError, TerminalProvider } from "@wosm/contracts";
import type { ProviderRegistry } from "../providers/registry.js";

export function resolveTerminalProviderOrThrow(
  providers: ProviderRegistry,
  providerId: string,
): TerminalProvider {
  if (providers.terminal.id === providerId) {
    return providers.terminal;
  }
  const error: SafeError = {
    tag: "TerminalProviderError",
    code: "TERMINAL_PROVIDER_UNAVAILABLE",
    message: "The requested terminal provider is not registered.",
    provider: providerId,
  };
  throw error;
}

export function resolveHarnessProviderOrThrow(
  providers: ProviderRegistry,
  providerId: string,
): HarnessProvider {
  const provider = providers.harnesses.get(providerId);
  if (provider !== undefined) {
    return provider;
  }
  const error: SafeError = {
    tag: "HarnessProviderError",
    code: "HARNESS_PROVIDER_UNAVAILABLE",
    message: "The requested harness provider is not registered.",
    provider: providerId,
  };
  throw error;
}
