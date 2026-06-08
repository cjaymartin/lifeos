// NIM-8: mutating a task by id must 404 for ids absent from the local mirror,
// instead of forwarding the unknown id upstream and mapping every provider
// error to 502. Genuine upstream failures must still surface as 502.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderError } from '@/features/tasks/ops/provider';

// In-memory test doubles, reconfigured per test.
const provider = {
  id: 'todoist',
  updateTask: vi.fn(async () => {}),
  deleteTask: vi.fn(async () => {}),
  completeTask: vi.fn(async () => {}),
  uncompleteTask: vi.fn(async () => {}),
  moveTask: vi.fn(async () => {}),
};
const mirror: { tasks: any[]; completed: any[] } = { tasks: [], completed: [] };

vi.mock('@/lib/auth', () => ({ requireSession: () => null }));
vi.mock('@/features/tasks/ops/sync-loop', () => ({
  getProvider: () => provider,
  syncNow: vi.fn(async () => {}),
}));
vi.mock('@/features/tasks/ops/store', () => ({
  getSnapshot: async () => ({ tasks: mirror.tasks }),
  getCompleted: async () => mirror.completed,
}));

const { PATCH, DELETE } = await import('@/pages/api/tasks/[id]');
const { POST: complete } = await import('@/pages/api/tasks/[id]/complete');
const { POST: reopen } = await import('@/pages/api/tasks/[id]/reopen');

function ctx(id: string, body?: unknown) {
  return {
    cookies: {} as any,
    params: { id },
    request: new Request(`http://test/api/tasks/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as any;
}

const ACTIVE = { id: 'real-1', content: 'a real task' };
const DONE = { id: 'done-1', content: 'a completed task' };

// Each verb under test, with a body the route accepts and the provider method it drives.
const VERBS = [
  { name: 'PATCH', run: (id: string) => PATCH(ctx(id, { content: 'x' })), method: 'updateTask' as const },
  { name: 'DELETE', run: (id: string) => DELETE(ctx(id)), method: 'deleteTask' as const },
  { name: 'complete', run: (id: string) => complete(ctx(id, {})), method: 'completeTask' as const },
  { name: 'reopen', run: (id: string) => reopen(ctx(id, {})), method: 'uncompleteTask' as const },
];

beforeEach(() => {
  mirror.tasks = [{ ...ACTIVE }];
  mirror.completed = [{ ...DONE }];
  provider.updateTask.mockReset().mockResolvedValue(undefined);
  provider.deleteTask.mockReset().mockResolvedValue(undefined);
  provider.completeTask.mockReset().mockResolvedValue(undefined);
  provider.uncompleteTask.mockReset().mockResolvedValue(undefined);
  provider.moveTask.mockReset().mockResolvedValue(undefined);
});

describe('NIM-8 — unknown task ids are 404, not 502', () => {
  for (const verb of VERBS) {
    it(`${verb.name} on an unknown id returns 404 without an upstream round-trip`, async () => {
      const res = await verb.run('does-not-exist');
      expect(res.status).toBe(404);
      expect(provider[verb.method]).not.toHaveBeenCalled();
    });
  }

  it('PATCH on a known active id still reaches the provider (200)', async () => {
    const res = await PATCH(ctx('real-1', { content: 'renamed' }));
    expect(res.status).toBe(200);
    expect(provider.updateTask).toHaveBeenCalledWith('real-1', expect.objectContaining({ content: 'renamed' }));
  });

  it('reopen on a known completed id is not falsely 404 (200)', async () => {
    const res = await reopen(ctx('done-1', {}));
    expect(res.status).toBe(200);
    expect(provider.uncompleteTask).toHaveBeenCalledWith('done-1');
  });
});

describe('NIM-8 — genuine upstream failures still 502', () => {
  it('PATCH maps a status-less provider failure on a known id to 502', async () => {
    provider.updateTask.mockRejectedValue(new ProviderError('Todoist command item_update failed: SYNC_ERROR'));
    const res = await PATCH(ctx('real-1', { content: 'x' }));
    expect(res.status).toBe(502);
  });

  it('complete maps a status-less provider failure on a known id to 502', async () => {
    provider.completeTask.mockRejectedValue(new ProviderError('Todoist command item_close failed: boom'));
    const res = await complete(ctx('real-1', {}));
    expect(res.status).toBe(502);
  });

  it('PATCH propagates a provider 4xx (e.g. id deleted upstream after sync) as that status', async () => {
    provider.updateTask.mockRejectedValue(new ProviderError('Todoist API 404 on /tasks', 404));
    const res = await PATCH(ctx('real-1', { content: 'x' }));
    expect(res.status).toBe(404);
  });
});
