import type { CommandReceipt, WosmCommand, WosmEvent, WosmSnapshot } from "@wosm/contracts";
import type { TuiObserverService } from "../../src/services/types.js";

export class FakeTuiObserverService implements TuiObserverService {
  readonly dispatched: WosmCommand[] = [];
  readonly events: WosmEvent[] = [];
  cleanupCount = 0;
  nextReceipt: CommandReceipt = {
    commandId: "cmd_tui_1",
    accepted: true,
    status: "accepted",
  };

  private readonly subscribers = new Set<Subscriber>();

  constructor(private snapshot: WosmSnapshot) {}

  async loadSnapshot(): Promise<WosmSnapshot> {
    return this.snapshot;
  }

  subscribeEvents(): AsyncIterable<WosmEvent> {
    const subscriber: Subscriber = {
      queue: [],
      waiters: [],
      active: true,
    };
    this.subscribers.add(subscriber);

    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => nextEvent(subscriber),
        return: async () => {
          subscriber.active = false;
          this.subscribers.delete(subscriber);
          this.cleanupCount += 1;
          flushSubscriber(subscriber);
          return { done: true, value: undefined };
        },
      }),
    };
  }

  async dispatch(command: WosmCommand): Promise<CommandReceipt> {
    this.dispatched.push(command);
    return this.nextReceipt;
  }

  async reconcile(reason?: string): Promise<WosmSnapshot> {
    const command: WosmCommand = {
      type: "observer.reconcile",
      payload: reason === undefined ? {} : { reason },
    };
    this.dispatched.push(command);
    return this.snapshot;
  }

  emit(event: WosmEvent): void {
    this.events.push(event);
    for (const subscriber of this.subscribers) {
      if (!subscriber.active) continue;
      const waiter = subscriber.waiters.shift();
      if (waiter === undefined) {
        subscriber.queue.push(event);
      } else {
        waiter({ done: false, value: event });
      }
    }
  }

  setSnapshot(snapshot: WosmSnapshot): void {
    this.snapshot = snapshot;
  }
}

type Subscriber = {
  queue: WosmEvent[];
  waiters: Array<(result: IteratorResult<WosmEvent>) => void>;
  active: boolean;
};

async function nextEvent(subscriber: Subscriber): Promise<IteratorResult<WosmEvent>> {
  const event = subscriber.queue.shift();
  if (event !== undefined) {
    return { done: false, value: event };
  }
  if (!subscriber.active) {
    return { done: true, value: undefined };
  }
  return new Promise((resolve) => {
    subscriber.waiters.push(resolve);
  });
}

function flushSubscriber(subscriber: Subscriber): void {
  for (;;) {
    const waiter = subscriber.waiters.shift();
    if (waiter === undefined) return;
    waiter({ done: true, value: undefined });
  }
}
