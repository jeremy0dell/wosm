import { Box, Text } from "ink";
import type { TuiToast } from "../services/types.js";

export type ToastStackProps = {
  toasts: readonly TuiToast[];
};

export function ToastStack({ toasts }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {toasts.slice(-3).map((toast) => (
        <Text key={toastKey(toast)} color={toast.kind === "error" ? "red" : "green"}>
          {formatToast(toast)}
        </Text>
      ))}
    </Box>
  );
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
