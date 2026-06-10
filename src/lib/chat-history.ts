// ── Per-stack chat history ───────────────────────────────────────────────────
//
// A feature stack's AI conversation, persisted local-first alongside the rest of
// its content. Stored as a dot-prefixed file so the content store (and thus the
// agent prompt) never sees it — see isHiddenContentFile in content-store.ts.

import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { dirname, join } from 'path';

export interface ChatProposal {
  summary: string;
  files: { path: string; description: string }[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  proposal?: ChatProposal;
  rawReply?: string;
  proposalStatus?: 'pending' | 'approved' | 'declined';
}

/** A persisted conversation is only ever user/assistant turns with string content. */
export function isChatMessage(m: unknown): m is ChatMessage {
  if (typeof m !== 'object' || m === null) return false;
  const { role, content } = m as Record<string, unknown>;
  return (role === 'user' || role === 'assistant') && typeof content === 'string';
}

/** Where a stack's persisted chat lives, relative to process.cwd(). */
export function chatHistoryPath(stackId: string): string {
  return join(process.cwd(), 'src/content', stackId, '.chat-history.json');
}

export async function loadChatHistory(stackId: string): Promise<ChatMessage[]> {
  try {
    const parsed = JSON.parse(await readFile(chatHistoryPath(stackId), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChatHistory(stackId: string, messages: ChatMessage[]): Promise<void> {
  const path = chatHistoryPath(stackId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(messages, null, 2) + '\n');
}

export async function clearChatHistory(stackId: string): Promise<void> {
  try {
    await unlink(chatHistoryPath(stackId));
  } catch {
    // already gone — nothing to clear
  }
}
