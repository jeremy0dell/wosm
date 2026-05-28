import { Text } from "ink";
import type { PendingCreateSession } from "../../orchestration/uiOrchestration.js";

export type OptimisticSessionRowProps = {
  row: PendingCreateSession;
};

export function OptimisticSessionRow({ row }: OptimisticSessionRowProps) {
  return <Text color="yellow"> [ ] ⠋ {row.branch} creating session...</Text>;
}
