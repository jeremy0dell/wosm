import { createContext, type ReactNode, useContext } from "react";

export type TuiMode = "normal" | "dev";

const TuiModeContext = createContext<TuiMode>("normal");

export type TuiModeProviderProps = {
  children: ReactNode;
  mode?: TuiMode;
};

export function TuiModeProvider({ children, mode = "normal" }: TuiModeProviderProps) {
  return <TuiModeContext.Provider value={mode}>{children}</TuiModeContext.Provider>;
}

export function useTuiMode(): TuiMode {
  return useContext(TuiModeContext);
}

export function resolveTuiModeFromEnv(env: Record<string, string | undefined>): TuiMode {
  const explicit = env.WOSM_TUI_DEV;
  if (explicit === "1" || explicit === "true") {
    return "dev";
  }
  return env.WOSM_TUI_SESSION_NAME?.includes("dev") === true ? "dev" : "normal";
}
