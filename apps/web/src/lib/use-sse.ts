'use client';

import { useEffect, useRef, useState } from 'react';
import { API_V1 } from './api';

export interface SSEMessage {
  /** Event name, e.g. "deployment.status", "log.build", "node.heartbeat". */
  type: string;
  data: unknown;
}

export type SSEStatus = 'connecting' | 'open' | 'closed';

interface UseSSEOptions {
  /** Called for every event on the channel. */
  onEvent?: (msg: SSEMessage) => void;
  /** Only subscribe when true (e.g. a tab is active). */
  enabled?: boolean;
}

/**
 * Subscribe to the API's Server-Sent Events stream for a channel such as
 * `app:<id>`, `deployment:<id>`, `node:<id>`, or `workspace:<id>`.
 *
 * The API emits named events (deployment.status, log.build, node.heartbeat, …)
 * plus an initial `open` event. We register a generic listener via the
 * underlying message plumbing by listening to each known event name.
 */
export function useSSE(channel: string | null | undefined, options: UseSSEOptions = {}) {
  const { onEvent, enabled = true } = options;
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const [lastEvent, setLastEvent] = useState<SSEMessage | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!channel || !enabled || typeof window === 'undefined') {
      setStatus('closed');
      return;
    }

    setStatus('connecting');
    const url = `${API_V1}/events?channel=${encodeURIComponent(channel)}`;
    const es = new EventSource(url, { withCredentials: true });

    const dispatch = (type: string, raw: string) => {
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* keep raw string */
      }
      const msg: SSEMessage = { type, data };
      setLastEvent(msg);
      handlerRef.current?.(msg);
    };

    // Known named events emitted by the control plane.
    const named = [
      'open',
      'deployment.status',
      'deployment.created',
      'log.build',
      'log.runtime',
      'node.heartbeat',
      'node.status',
      'command.update',
    ];
    const listeners: Array<[string, (e: MessageEvent) => void]> = [];
    for (const name of named) {
      const fn = (e: MessageEvent) => {
        if (name === 'open') setStatus('open');
        dispatch(name, e.data);
      };
      es.addEventListener(name, fn as EventListener);
      listeners.push([name, fn]);
    }
    // Default unnamed messages.
    es.onmessage = (e) => dispatch('message', e.data);
    es.onopen = () => setStatus('open');
    es.onerror = () => {
      // EventSource auto-reconnects; reflect the transient state.
      setStatus((s) => (s === 'open' ? 'connecting' : s));
    };

    return () => {
      for (const [name, fn] of listeners) es.removeEventListener(name, fn as EventListener);
      es.close();
      setStatus('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, enabled]);

  return { status, lastEvent };
}
