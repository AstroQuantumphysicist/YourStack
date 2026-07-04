import { afterEach, describe, expect, it, vi } from 'vitest';
import { YourStackClient } from '../client.js';

describe('YourStackClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fromEnv throws without a token', () => {
    const saved = process.env.YOURSTACK_TOKEN;
    delete process.env.YOURSTACK_TOKEN;
    expect(() => YourStackClient.fromEnv()).toThrow(/YOURSTACK_TOKEN/);
    if (saved) process.env.YOURSTACK_TOKEN = saved;
  });

  it('builds the /v1 URL and sends the bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new YourStackClient('http://api.local/', 'ys_test');
    const res = await client.get('/auth/me');
    expect(res).toEqual({ ok: true });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://api.local/v1/auth/me');
    expect(call[1].headers).toMatchObject({ authorization: 'Bearer ys_test' });
  });

  it('throws a helpful error on API failure', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'nope' } }), { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new YourStackClient('http://api.local', 'ys_test');
    await expect(client.get('/apps/x')).rejects.toThrow(/403 forbidden: nope/);
  });
});
