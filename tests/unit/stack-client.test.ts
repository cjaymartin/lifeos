import { describe, it, expect, afterEach, vi } from 'vitest';
import { apiCall, makeOptimistic } from '@/lib/client/stack-client';

function mockFetch(handler: (url: string, init?: RequestInit) => Partial<Response> | Promise<Partial<Response>>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const res = await handler(url, init);
    return { ok: true, status: 200, json: async () => ({}), ...res } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('apiCall', () => {
  it('GET returns parsed JSON without mutation headers', async () => {
    const { calls } = mockFetch(() => ({ json: async () => ({ items: [1, 2] }) }));
    const data = await apiCall<{ items: number[] }>('/api/grocery');
    expect(data.items).toEqual([1, 2]);
    expect(calls[0].init?.method ?? 'GET').toBe('GET');
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('mutations always send a JSON content-type and body — the CSRF/proxy rule', async () => {
    const { calls } = mockFetch(() => ({}));
    await apiCall('/api/tasks/1/complete', { method: 'POST' });
    const init = calls[0].init!;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{}'); // bodyless POSTs 403 behind the TLS proxy
  });

  it('serializes the body for mutations', async () => {
    const { calls } = mockFetch(() => ({}));
    await apiCall('/api/grocery/staples', { method: 'PATCH', body: { id: 'x', status: 'low' } });
    expect(calls[0].init!.body).toBe('{"id":"x","status":"low"}');
  });

  it('throws the server-supplied error message on failure', async () => {
    mockFetch(() => ({ ok: false, status: 422, json: async () => ({ error: 'bad link' }) }));
    await expect(apiCall('/api/grocery/product-map', { method: 'POST', body: {} })).rejects.toThrow('bad link');
  });

  it('falls back to HTTP status when the error body is not JSON', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }));
    await expect(apiCall('/x', { method: 'POST' })).rejects.toThrow('HTTP 500');
  });

  it('returns null when the response has no JSON body', async () => {
    mockFetch(() => ({ json: async () => { throw new Error('empty'); } }));
    await expect(apiCall('/x', { method: 'DELETE' })).resolves.toBeNull();
  });
});

describe('makeOptimistic', () => {
  type S = { items: string[] };

  function setup() {
    let state: S = { items: ['a', 'b'] };
    const apply = vi.fn((updater: (s: S) => S) => { state = updater(state); });
    const refetch = vi.fn(async () => {});
    const onError = vi.fn();
    const mutate = makeOptimistic<S>({ apply, refetch, onError });
    return { mutate, apply, refetch, onError, state: () => state };
  }

  it('applies the local update immediately, then runs the remote call', async () => {
    const { mutate, state, refetch } = setup();
    const order: string[] = [];
    await mutate(
      (s) => { order.push('local'); return { items: s.items.filter((i) => i !== 'a') }; },
      async () => { order.push('remote'); },
    );
    expect(order).toEqual(['local', 'remote']);
    expect(state().items).toEqual(['b']);
    expect(refetch).not.toHaveBeenCalled(); // default: no resync on success
  });

  it("sync: 'always' refetches after a successful remote call", async () => {
    const { mutate, refetch } = setup();
    await mutate((s) => s, async () => {}, { sync: 'always' });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('rolls back via refetch and reports when the remote call fails', async () => {
    const { mutate, refetch, onError } = setup();
    await mutate(
      (s) => ({ items: [] }),
      async () => { throw new Error('server said no'); },
    );
    expect(refetch).toHaveBeenCalledTimes(1); // server truth restored
    expect(onError).toHaveBeenCalledWith('server said no');
  });

  it('local-only mutations need no remote call', async () => {
    const { mutate, state, refetch } = setup();
    await mutate((s) => ({ items: [...s.items, 'c'] }));
    expect(state().items).toEqual(['a', 'b', 'c']);
    expect(refetch).not.toHaveBeenCalled();
  });
});
