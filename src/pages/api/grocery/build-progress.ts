import type { APIRoute } from 'astro';
import { basename } from 'path';
import { requireSession } from '@/lib/auth';
import { isJobRunning, readBuildLog } from '@/features/grocery/jobs';
import { parseStreamEvents, type ProgressEvent } from '@/lib/jobs/runner';

export type { ProgressEvent };

const trunc = (s: unknown, n: number) => {
  const str = String(s ?? '').trim();
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Grocery-flavoured labels for the cart-build progress feed. */
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

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const [running, raw] = await Promise.all([isJobRunning('build-carts'), readBuildLog()]);

  const { events, done, ok } = parseStreamEvents(raw, {
    toolLabel,
    resultLabels: { ok: 'Cart ready', fail: 'Build failed — check the cart card or retry' },
  });

  return new Response(JSON.stringify({ running, events, done, ok }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
