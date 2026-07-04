import IORedis, { type Redis } from 'ioredis';

const GLOBAL_CHANNEL = 'noderail:events';

export interface RealtimeEvent {
  channel: string;
  type: string;
  data: unknown;
}

type Listener = (event: RealtimeEvent) => void;

/**
 * Redis pub/sub backed realtime hub. Any process (API or worker) can publish an
 * event on a logical channel (e.g. `deployment:<id>`). All API instances receive
 * it via the shared Redis channel and fan it out to locally-connected SSE
 * clients subscribed to that logical channel.
 */
export class RealtimeHub {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(redisUrl: string) {
    this.pub = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.sub = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    void this.sub.subscribe(GLOBAL_CHANNEL);
    this.sub.on('message', (_channel, payload) => {
      try {
        const event = JSON.parse(payload) as RealtimeEvent;
        this.dispatchLocal(event);
      } catch {
        /* ignore malformed */
      }
    });
  }

  async publish(channel: string, type: string, data: unknown): Promise<void> {
    const event: RealtimeEvent = { channel, type, data };
    await this.pub.publish(GLOBAL_CHANNEL, JSON.stringify(event));
  }

  /** Subscribe a local SSE connection to a logical channel. Returns an unsubscribe fn. */
  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(channel);
    };
  }

  private dispatchLocal(event: RealtimeEvent): void {
    const set = this.listeners.get(event.channel);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        /* isolate listener failures */
      }
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
