import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { getSnapshot, taskEvents } from '@/features/tasks/ops/store';
import { ensureSyncLoop } from '@/features/tasks/ops/sync-loop';

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/tasks/stream — Server-Sent Events.
 * Emits `change` events (data: {"version":N}) whenever the mirror updates;
 * clients refetch /api/tasks on each one. EventSource auto-reconnects.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  ensureSyncLoop();
  const encoder = new TextEncoder();
  let onChange: ((version: number) => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (onChange) taskEvents.off('change', onChange);
        if (heartbeat) clearInterval(heartbeat);
        onChange = null;
        heartbeat = null;
      };

      const snapshot = await getSnapshot();
      send('hello', { version: snapshot.version });

      onChange = (version: number) => send('change', { version });
      taskEvents.on('change', onChange);

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
      (heartbeat as any).unref?.();
    },
    cancel() {
      if (onChange) taskEvents.off('change', onChange);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
