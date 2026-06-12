import type { TuiToast } from "@wosm/dashboard-core";
import { Box, Text } from "ink";

export type ToastStackProps = {
  toasts: readonly TuiToast[];
};

export function ToastStack({ toasts }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }
  const keyedToasts = keyedRecentToasts(toasts);
  return (
    <Box flexDirection="column" marginTop={1}>
      {keyedToasts.map(({ key, toast }) => (
        <Text key={key} color={toast.kind === "error" ? "red" : "green"}>
          {formatToast(toast)}
        </Text>
      ))}
    </Box>
  );
}

function keyedRecentToasts(toasts: readonly TuiToast[]): Array<{ key: string; toast: TuiToast }> {
  const occurrences = new Map<string, number>();
  return toasts.slice(-3).map((toast) => {
    const baseKey = toastKey(toast);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    return {
      key: `${baseKey}:${occurrence}`,
      toast,
    };
  });
}

function toastKey(toast: TuiToast): string {
  return [toast.kind, toast.commandId, toast.diagnosticId, toast.traceId, toast.message]
    .filter((part): part is string => part !== undefined)
    .join(":");
}

function formatToast(toast: TuiToast): string {
  const details: string[] = [];
  if (toast.hint !== undefined) details.push(toast.hint);
  if (toast.traceId !== undefined) details.push(`trace ${toast.traceId}`);
  if (toast.diagnosticId !== undefined) details.push(`diagnostic ${toast.diagnosticId}`);
  return details.length === 0 ? toast.message : `${toast.message} (${details.join(" | ")})`;
}
