import type { APIRoute } from 'astro';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { verifySession } from '@/lib/auth';
import { BUILD_LOG, isJobRunning } from '@/lib/grocery-runner';

export interface ProgressEvent {
  t: 'tool' | 'note' | 'result';
  label: string;
}

const trunc = (s: unknown, n: number) => {
  const str = String(s ?? '').trim();
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function toolLabel(name: string, input: any): string {
  switch (name) {
    case 'WebSearch':
      return `Searching the web — “${trunc(input?.query, 60)}”`;
    case 'WebFetch':
      try { return `Reading ${new URL(input?.url).hostname.replace(/^www\./, '')}`; }
      catch { return 'Reading a product page'; }
    case 'mcp__claude_ai_Gmail__search_threads':
      return `Searching Gmail — ${trunc(input?.query?.replace(/from:\S+\s*/g, ''), 55) || 'past orders'}`;
    case 'mcp__claude_ai_Gmail__get_thread':
      return 'Reading a past order email';
    case 'Read':
      return `Reading ${basename(String(input?.file_path ?? 'a file'))}`;
    case 'Write': {
      const f = basename(String(input?.file_path ?? 'a file'));
      return f === 'carts.json' ? 'Writing the cart' : `Updating ${f}`;
    }
    case 'TodoWrite':
      return 'Planning';
    default:
      return name.replace(/^mcp__\w+__/, '').replace(/_/g, ' ');
  }
}

/** Parse claude's stream-json log into a friendly event feed. */
function parseEvents(raw: string): { events: ProgressEvent[]; done: boolean; ok: boolean | null } {
  const events: ProgressEvent[] = [];
  let done = false;
  let ok: boolean | null = null;

  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    let j: any;
    try { j = JSON.parse(s); } catch { continue; }

    if (j.type === 'assistant') {
      for (const block of j.message?.content ?? []) {
        if (block.type === 'tool_use') {
          events.push({ t: 'tool', label: toolLabel(block.name, block.input) });
        } else if (block.type === 'text' && block.text?.trim()) {
          // The agent narrating its plan — first line only, kept short
          events.push({ t: 'note', label: trunc(block.text.split('\n')[0], 90) });
        }
      }
    } else if (j.type === 'result') {
      done = true;
      ok = j.subtype === 'success' && !j.is_error;
      events.push({ t: 'result', label: ok ? 'Cart ready' : 'Build failed — check the cart card or retry' });
    }
  }

  return { events: events.slice(-60), done, ok };
}

export const GET: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  const running = await isJobRunning('build-carts');
  let raw = '';
  try { raw = await readFile(BUILD_LOG, 'utf-8'); } catch {}

  const { events, done, ok } = parseEvents(raw);
  return new Response(JSON.stringify({ running, events, done, ok }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
