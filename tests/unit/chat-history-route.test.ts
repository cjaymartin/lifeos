// NIM-10: the /api/chat/history endpoint persists, restores, and clears a
// stack's conversation — and refuses stackIds that could escape the content dir.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@/lib/auth', () => ({ requireSession: () => null }));

const { GET, PUT, DELETE } = await import('@/pages/api/chat/history');

let sandbox: string;
const realCwd = process.cwd();

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'lifeos-chatroute-'));
  mkdirSync(join(sandbox, 'src/content/grocery'), { recursive: true });
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(realCwd);
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

function getCtx(stackId?: string) {
  const url = new URL(`http://test/api/chat/history${stackId === undefined ? '' : `?stackId=${encodeURIComponent(stackId)}`}`);
  return { cookies: {} as any, url, request: new Request(url) } as any;
}

function bodyCtx(body: unknown) {
  return {
    cookies: {} as any,
    request: new Request('http://test/api/chat/history', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe('/api/chat/history', () => {
  it('GET returns an empty history for a stack with no saved conversation', async () => {
    const res = await GET(getCtx('grocery'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [] });
  });

  it('PUT persists a conversation that a later GET restores', async () => {
    const messages = [{ role: 'user', content: 'Add milk' }];
    const put = await PUT(bodyCtx({ stackId: 'grocery', messages }));
    expect(put.status).toBe(200);

    const got = await GET(getCtx('grocery'));
    expect(await got.json()).toEqual({ messages });
  });

  it('DELETE clears a persisted conversation', async () => {
    await PUT(bodyCtx({ stackId: 'grocery', messages: [{ role: 'user', content: 'hi' }] }));
    const del = await DELETE(getCtx('grocery'));
    expect(del.status).toBe(200);
    expect(await (await GET(getCtx('grocery'))).json()).toEqual({ messages: [] });
  });

  it('rejects a path-traversal stackId instead of touching the filesystem', async () => {
    expect((await GET(getCtx('../../etc'))).status).toBe(400);
    expect((await DELETE(getCtx('../../etc'))).status).toBe(400);
    expect((await PUT(bodyCtx({ stackId: '../../etc', messages: [] }))).status).toBe(400);
  });

  it('rejects a PUT whose messages field is not an array', async () => {
    expect((await PUT(bodyCtx({ stackId: 'grocery', messages: 'nope' }))).status).toBe(400);
  });

  it('rejects a PUT whose messages are not well-formed chat turns', async () => {
    // wrong role, non-string content, and a non-object entry are all refused.
    expect((await PUT(bodyCtx({ stackId: 'grocery', messages: [{ role: 'system', content: 'x' }] }))).status).toBe(400);
    expect((await PUT(bodyCtx({ stackId: 'grocery', messages: [{ role: 'user', content: 42 }] }))).status).toBe(400);
    expect((await PUT(bodyCtx({ stackId: 'grocery', messages: ['nope'] }))).status).toBe(400);
  });
});
