import type { EventFilter, WosmEvent } from "@wosm/contracts";
import {
  WosmEventSchema,
  wosmEventCommandId,
  wosmEventTimestamp,
  wosmEventTraceId,
} from "@wosm/contracts";
import { Effect, Queue } from "@wosm/runtime";

export type ObserverEventBus = {
  publish(event: WosmEvent): void;
  subscribe(filter?: EventFilter): AsyncIterable<WosmEvent>;
};

type Subscriber = {
  filter?: EventFilter;
  queue: Queue.Queue<WosmEvent>;
  active: boolean;
};

export function createObserverEventBus(): ObserverEventBus {
  const subscribers = new Set<Subscriber>();

  return {
    publish: (event) => {
      const parsedEvent = WosmEventSchema.parse(event);
      for (const subscriber of subscribers) {
        if (subscriber.active && eventMatchesFilter(parsedEvent, subscriber.filter)) {
          Effect.runSync(Queue.offer(subscriber.queue, parsedEvent));
        }
      }
    },
    subscribe: (filter) => effectQueueSubscription(subscribers, filter),
  };
}

function effectQueueSubscription(
  subscribers: Set<Subscriber>,
  filter?: EventFilter,
): AsyncIterable<WosmEvent> {
  const subscriber: Subscriber = {
    ...(filter === undefined ? {} : { filter }),
    queue: Effect.runSync(Queue.unbounded<WosmEvent>()),
    active: true,
  };
  subscribers.add(subscriber);

  const iterator: AsyncIterator<WosmEvent> = {
    next: async () => {
      if (!subscriber.active) {
        return { done: true, value: undefined };
      }
      try {
        const event = await Effect.runPromise(Queue.take(subscriber.queue));
        return subscriber.active ? { done: false, value: event } : { done: true, value: undefined };
      } catch {
        return { done: true, value: undefined };
      }
    },
    return: async () => {
      // Remove the subscriber and shut down its queue so pending takes unblock.
      subscriber.active = false;
      subscribers.delete(subscriber);
      await Effect.runPromise(Queue.shutdown(subscriber.queue));
      return { done: true, value: undefined };
    },
  };

  return {
    [Symbol.asyncIterator]: () => iterator,
  };
}

function eventMatchesFilter(event: WosmEvent, filter: EventFilter | undefined): boolean {
  if (filter === undefined) {
    return true;
  }

  if (filter.type !== undefined) {
    const types = Array.isArray(filter.type) ? filter.type : [filter.type];
    if (!types.includes(event.type)) {
      return false;
    }
  }

  if (filter.commandId !== undefined) {
    if (wosmEventCommandId(event) !== filter.commandId) {
      return false;
    }
  }

  if (filter.traceId !== undefined) {
    if (wosmEventTraceId(event) !== filter.traceId) {
      return false;
    }
  }

  if (filter.since !== undefined) {
    const timestamp = wosmEventTimestamp(event);
    if (timestamp !== undefined) {
      return Date.parse(timestamp) >= Date.parse(filter.since);
    }
  }

  return true;
}
