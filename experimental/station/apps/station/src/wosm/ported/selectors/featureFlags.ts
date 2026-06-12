import {
  type ClientFeatureFlagKey,
  type ClientFeatureFlags,
  defaultClientFeatureFlagValue,
  type WosmSnapshot,
} from "@wosm/contracts";

export function selectTuiFeatureFlags(
  snapshot: WosmSnapshot | undefined,
): ClientFeatureFlags["flags"] {
  return (
    snapshot?.featureFlags?.flags ?? {
      sessionResumeAgent: defaultClientFeatureFlagValue("sessionResumeAgent"),
    }
  );
}

export function isTuiFeatureEnabled(
  snapshot: WosmSnapshot | undefined,
  key: ClientFeatureFlagKey,
): boolean {
  return selectTuiFeatureFlags(snapshot)[key] ?? defaultClientFeatureFlagValue(key);
}
