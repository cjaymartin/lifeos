import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pollJob, watchRefreshJob, watchFlagJob } from '@/lib/client/job-watch';

/** Queue-based fetch mock: each call shifts the next scripted response. */
function scriptFetch(script: Array<{ url?: RegExp; ok?: boolean; json?: unknown; reject?: boolean }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = script.length > 1 ? script.shift()! : script[0];
    if (step.url && !step.url.test(url)) throw new Error(`unexpected fetch ${url}`);
    if (step.reject) throw new Error('network down');
    return {
      ok: step.ok ?? true,
      json: async () => step.json ?? {},
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pollJob', () => {
  it('waits firstDelayMs, then polls at intervalMs until the verdict is done', async () => {
    const { fn } = scriptFetch([
      { json: { running: true } },
      { json: { running: true } },
      { json: { running: false } },
    ]);
    const seen: unknown[] = [];
    const handle = pollJob<{ running: boolean }>({
      statusUrl: '/api/x/status',
      firstDelayMs: 8000,
      intervalMs: 4000,
      onStatus: (s) => seen.push(s),
      verdict: (s, { attempts }) => (!s.running && attempts > 2 ? 'done' : 'pending'),
    });

    await vi.advanceTimersByTimeAsync(7999);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fn).toHaveBeenCalledTimes(3);
    await expect(handle.result).resolves.toBe('done');
    expect(seen).toHaveLength(3);
  });

  it('resolves error when maxAttempts is exhausted', async () => {
    scriptFetch([{ json: { running: true } }]);
    const handle = pollJob({
      statusUrl: '/s',
      firstDelayMs: 0,
      intervalMs: 10,
      maxAttempts: 3,
      verdict: () => 'pending',
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(handle.result).resolves.toBe('error');
  });

  it('cancel stops future polls', async () => {
    const { fn } = scriptFetch([{ json: {} }]);
    const handle = pollJob({
      statusUrl: '/s',
      firstDelayMs: 0,
      intervalMs: 1000,
      verdict: () => 'pending',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    handle.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fetchError 'error' (default) resolves error immediately", async () => {
    scriptFetch([{ reject: true }]);
    const handle = pollJob({ statusUrl: '/s', firstDelayMs: 0, verdict: () => 'pending' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(handle.result).resolves.toBe('error');
  });

  it("fetchError 'continue' keeps polling through failures", async () => {
    const { fn } = scriptFetch([
      { reject: true },
      { json: { done: true } },
    ]);
    const handle = pollJob<{ done?: boolean }>({
      statusUrl: '/s',
      firstDelayMs: 0,
      intervalMs: 10,
      fetchError: 'continue',
      verdict: (s) => (s.done ? 'done' : 'pending'),
    });
    await vi.advanceTimersByTimeAsync(50);
    await expect(handle.result).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('watchRefreshJob (mtime protocol)', () => {
  it('snapshots mtime, POSTs the trigger, resolves done when the file changes', async () => {
    const { calls } = scriptFetch([
      { json: { running: false, lastUpdated: 100 } }, // snapshot
      { json: {} },                                    // trigger POST
      { json: { running: true, lastUpdated: 100 } },   // poll 1
      { json: { running: true, lastUpdated: 200 } },   // poll 2 — changed
    ]);
    const promise = watchRefreshJob({
      statusUrl: '/api/refresh/status',
      triggerUrl: '/api/refresh',
      firstDelayMs: 8000,
      intervalMs: 4000,
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).resolves.toBe('done');
    expect(calls[1].url).toBe('/api/refresh');
    expect(calls[1].init?.method).toBe('POST');
  });

  it('resolves error when the process exits without changing the file', async () => {
    scriptFetch([
      { json: { running: false, lastUpdated: 100 } },
      { json: {} },
      { json: { running: true, lastUpdated: 100 } },
      { json: { running: true, lastUpdated: 100 } },
      { json: { running: false, lastUpdated: 100 } }, // exited, unchanged
    ]);
    const promise = watchRefreshJob({
      statusUrl: '/s',
      triggerUrl: '/t',
      firstDelayMs: 0,
      intervalMs: 10,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('error');
  });

  it('resolves error without polling when the trigger fails', async () => {
    const { fn } = scriptFetch([
      { json: { running: false, lastUpdated: 100 } },
      { ok: false, json: {} },
    ]);
    const promise = watchRefreshJob({ statusUrl: '/s', triggerUrl: '/t', firstDelayMs: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('error');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('watchFlagJob (boolean-flag protocol)', () => {
  it('polls until the flag clears (after minAttempts)', async () => {
    scriptFetch([
      { json: { scanning: true } },
      { json: { scanning: true } },
      { json: { scanning: false } },
    ]);
    const promise = watchFlagJob({
      statusUrl: '/api/grocery/status',
      flag: 'scanning',
      firstDelayMs: 0,
      intervalMs: 10,
      minAttempts: 2,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('done');
  });

  it('a cleared flag before minAttempts keeps polling (startup window)', async () => {
    const { fn } = scriptFetch([
      { json: { scanning: false } }, // attempt 1 — inside startup window
      { json: { scanning: false } }, // attempt 2 — counts
    ]);
    const promise = watchFlagJob({
      statusUrl: '/s',
      flag: 'scanning',
      firstDelayMs: 0,
      intervalMs: 10,
      minAttempts: 1,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
