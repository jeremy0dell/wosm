import type { CommandReceipt, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import type { TuiCommandCompletion, TuiObserverService } from "@wosm/dashboard-core";

export function createFakeTuiObserverService(snapshot: WosmSnapshot): TuiObserverService {
  return new FakeDevTuiObserverService(snapshot);
}

class FakeDevTuiObserverService implements TuiObserverService {
  private commandCount = 0;

  constructor(private readonly snapshot: WosmSnapshot) {}

  async loadSnapshot(): Promise<WosmSnapshot> {
    return this.snapshot;
  }

  subscribeEvents(): AsyncIterable<WosmEvent> {
    return {
      [Symbol.asyncIterator]: () => fakeEventIterator(),
    };
  }

  async dispatch(_command: WosmCommand): Promise<CommandReceipt> {
    this.commandCount += 1;
    return {
      commandId: `cmd_fake_tui_${this.commandCount}`,
      accepted: true,
      status: "accepted",
    };
  }

  async waitForCommandCompletion(commandId: string): Promise<TuiCommandCompletion> {
    return {
      status: "succeeded",
      commandId,
    };
  }

  async reconcile(_reason?: string): Promise<WosmSnapshot> {
    return this.snapshot;
  }
}

function fakeEventIterator(): AsyncIterator<WosmEvent> {
  let active = true;
  let resolveNext: ((result: IteratorResult<WosmEvent>) => void) | undefined;
  return {
    next: async () => {
      if (!active) {
        return { done: true, value: undefined };
      }
      return new Promise<IteratorResult<WosmEvent>>((resolve) => {
        resolveNext = resolve;
      });
    },
    return: async () => {
      active = false;
      resolveNext?.({ done: true, value: undefined });
      resolveNext = undefined;
      return { done: true, value: undefined };
    },
  };
}
