import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadChatHistory, saveChatHistory, clearChatHistory, chatHistoryPath } from '@/lib/chat-history';
import type { ChatMessage } from '@/lib/chat-history';
import { loadStackContent } from '@/lib/content-store';

let sandbox: string;
const realCwd = process.cwd();

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'lifeos-chat-'));
  mkdirSync(join(sandbox, 'src/content/grocery'), { recursive: true });
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(realCwd);
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe('chat history persistence', () => {
  it('returns an empty history when nothing has been saved', async () => {
    expect(await loadChatHistory('grocery')).toEqual([]);
  });

  it('round-trips a saved conversation, preserving proposal state', async () => {
    const convo: ChatMessage[] = [
      { role: 'user', content: 'Add milk' },
      {
        role: 'assistant',
        content: "Here's what I'd do",
        rawReply: 'raw…WRITE_PROPOSAL:{…}',
        proposal: { summary: 'Add milk', files: [{ path: 'grocery.json', description: 'add milk' }] },
        proposalStatus: 'approved',
      },
    ];
    await saveChatHistory('grocery', convo);
    expect(await loadChatHistory('grocery')).toEqual(convo);
  });

  it('clear deletes the persisted file and resets to empty', async () => {
    await saveChatHistory('grocery', [{ role: 'user', content: 'hi' }]);
    expect(existsSync(chatHistoryPath('grocery'))).toBe(true);

    await clearChatHistory('grocery');

    expect(existsSync(chatHistoryPath('grocery'))).toBe(false);
    expect(await loadChatHistory('grocery')).toEqual([]);
  });

  it('clear is a no-op when there is nothing to clear', async () => {
    await expect(clearChatHistory('grocery')).resolves.toBeUndefined();
  });

  it('keeps each stack history independent — clearing one leaves others intact', async () => {
    mkdirSync(join(sandbox, 'src/content/recipes'), { recursive: true });
    await saveChatHistory('grocery', [{ role: 'user', content: 'grocery talk' }]);
    await saveChatHistory('recipes', [{ role: 'user', content: 'recipe talk' }]);

    await clearChatHistory('grocery');

    expect(await loadChatHistory('grocery')).toEqual([]);
    expect(await loadChatHistory('recipes')).toEqual([{ role: 'user', content: 'recipe talk' }]);
  });

  it('does not leak the saved conversation into the stack content dump (agent prompt)', async () => {
    writeFileSync(join(sandbox, 'src/content/grocery/grocery.json'), '{"items":[]}');
    await saveChatHistory('grocery', [{ role: 'user', content: 'secret chatter that must not reach the model' }]);

    const dump = await loadStackContent('grocery');
    expect(dump).toContain('### grocery.json');
    expect(dump).not.toContain('secret chatter that must not reach the model');
    expect(dump).not.toContain('.chat-history.json');
  });
});
