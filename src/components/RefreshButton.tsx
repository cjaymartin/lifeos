import { useState, useCallback } from 'react';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';

type State = 'idle' | 'loading' | 'done' | 'error';

export default function RefreshButton() {
  const [state, setState] = useState<State>('idle');

  const handleRefresh = useCallback(async () => {
    if (state === 'loading') return;
    setState('loading');

    try {
      // Snapshot current mtime so we can detect when the file actually changes
      const before = await fetch('/api/refresh/status');
      const { lastUpdated: initialMtime } = await before.json() as { lastUpdated: number | null };

      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) { setState('error'); return; }

      // Poll every 4s; first check after 8s (Claude startup + first tool call)
      let attempts = 0;
      const MAX = 60; // 4 min max

      const poll = async (): Promise<void> => {
        if (++attempts > MAX) { setState('error'); return; }
        try {
          const r = await fetch('/api/refresh/status');
          const { running, lastUpdated } = await r.json() as { running: boolean; lastUpdated: number | null };

          if (lastUpdated !== initialMtime) {
            // today.json was rewritten — success
            setState('done');
            setTimeout(() => window.location.reload(), 800);
          } else if (!running && attempts > 2) {
            // Process exited but file didn't change — something went wrong
            setState('error');
          } else {
            setTimeout(poll, 4000);
          }
        } catch {
          setState('error');
        }
      };

      setTimeout(poll, 8000);
    } catch {
      setState('error');
    }
  }, [state]);

  const label  = { idle: 'Refresh', loading: 'Refreshing…', done: 'Done', error: 'Failed' }[state];
  const colors = {
    idle:    'border-border text-muted-foreground hover:text-foreground hover:bg-accent/30',
    loading: 'border-border text-muted-foreground cursor-wait',
    done:    'border-emerald-500/30 text-emerald-500 bg-emerald-500/10',
    error:   'border-destructive/30 text-destructive bg-destructive/10',
  }[state];

  return (
    <button
      onClick={handleRefresh}
      disabled={state === 'loading'}
      title={state === 'loading' ? 'Running /populate-daily…' : 'Refresh today\'s briefing'}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${colors}`}
    >
      {state === 'loading' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
      {state === 'idle'    && <RefreshCw className="w-3.5 h-3.5" />}
      {state === 'done'    && <Check      className="w-3.5 h-3.5" />}
      {state === 'error'   && <AlertCircle className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  );
}
