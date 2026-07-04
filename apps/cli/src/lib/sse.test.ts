import { describe, expect, it } from 'vitest';
import { SseParser } from './sse.js';

describe('SseParser', () => {
  it('parses a complete event frame', () => {
    const parser = new SseParser();
    const events = parser.push('event: deployment.status\ndata: {"status":"running"}\n\n');
    expect(events).toEqual([{ event: 'deployment.status', data: '{"status":"running"}' }]);
  });

  it('defaults the event name to "message"', () => {
    const parser = new SseParser();
    expect(parser.push('data: hello\n\n')).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('buffers frames split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('event: log.build\ndata: par')).toEqual([]);
    const events = parser.push('tial line\n\n');
    expect(events).toEqual([{ event: 'log.build', data: 'partial line' }]);
  });

  it('joins multiple data lines with newlines', () => {
    const parser = new SseParser();
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual([
      { event: 'message', data: 'line1\nline2' },
    ]);
  });

  it('ignores comment/keep-alive lines', () => {
    const parser = new SseParser();
    expect(parser.push(': keep-alive\n\n')).toEqual([]);
    expect(parser.push('event: open\ndata: {}\n\n')).toEqual([{ event: 'open', data: '{}' }]);
  });

  it('handles CRLF line endings and back-to-back frames', () => {
    const parser = new SseParser();
    const events = parser.push('event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n');
    expect(events).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });
});
