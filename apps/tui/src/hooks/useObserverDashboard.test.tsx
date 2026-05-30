import type { WosmEvent } from "@wosm/contracts";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, it } from "vitest";
import { createCommandSnapshot } from "../../test/fixtures/snapshots.js";
import { FakeTuiObserverService } from "../../test/support/fakeObserverService.js";
import { useObserverDashboard } from "./useObserverDashboard.js";

describe("useObserverDashboard", () => {
  it("renders initial snapshots and cleans up event subscriptions", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<DashboardProbe service={service} />);

    await waitFor(() => instance.lastFrame() === "ready:1:idle:0");
    await waitFor(() => service.subscribeCount === 1);
    instance.unmount();
    await waitFor(() => service.cleanupCount === 1);
  });

  it("applies live events to the rendered snapshot", async () => {
    const snapshot = createCommandSnapshot("idle");
    const service = new FakeTuiObserverService(snapshot);
    const instance = render(<DashboardProbe service={service} />);
    const event: WosmEvent = {
      type: "worktree.updated",
      worktreeId: "wt_web_idle",
      patch: {
        display: {
          statusLabel: "working",
          sortPriority: 30,
          alert: false,
          reason: "Harness reported active generation.",
        },
      },
    };

    await waitFor(() => service.subscribeCount === 1);
    service.emit(event);

    await waitFor(() => instance.lastFrame() === "ready:1:working:0");
    instance.unmount();
  });
});

function DashboardProbe({ service }: { service: FakeTuiObserverService }) {
  const dashboard = useObserverDashboard({ service });
  const firstStatus = dashboard.snapshot?.rows[0]?.display.statusLabel ?? "none";
  return (
    <Text>
      {dashboard.loading ? "loading" : "ready"}:{dashboard.snapshot?.rows.length ?? 0}:{firstStatus}
      :{dashboard.toasts.length}
    </Text>
  );
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  for (;;) {
    if (assertion()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for assertion");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
