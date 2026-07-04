/**
 * A parsed Server-Sent Event frame. `event` defaults to `"message"` per the SSE
 * spec when no `event:` field is present.
 */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental SSE frame parser. Feed it arbitrary chunks of the response body
 * (which may split frames across chunk boundaries); it buffers partial frames
 * and returns whole ones as they complete.
 *
 * Frames are separated by a blank line. Within a frame, `field: value` lines
 * are accumulated; multiple `data:` lines join with `\n`. Comment lines
 * (starting with `:`, e.g. keep-alives) are ignored.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    // Normalize CRLF so frame splitting is newline-agnostic.
    this.buffer = this.buffer.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let sep: number;
    while ((sep = this.buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const parsed = parseFrame(rawFrame);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

function parseFrame(raw: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  let sawField = false;
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single space after the colon is stripped per the SSE spec.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
      sawField = true;
    } else if (field === 'data') {
      dataLines.push(value);
      sawField = true;
    } else if (field === 'id' || field === 'retry') {
      sawField = true;
    }
  }
  if (!sawField) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * Connect to an SSE endpoint and invoke `onEvent` for each frame until the
 * stream ends, the signal aborts, or `onEvent` returns `false` (stop).
 */
export async function streamSse(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal },
  onEvent: (evt: SseEvent) => void | boolean,
): Promise<void> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'text/event-stream', ...init.headers },
    signal: init.signal,
  });
  if (!res.ok || !res.body) {
    // Surface the status so callers can map it to a friendly error.
    const err = new Error(`SSE connection failed (${res.status})`) as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    try {
      err.body = await res.text();
    } catch {
      // ignore
    }
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const evt of parser.push(chunk)) {
        if (onEvent(evt) === false) return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
