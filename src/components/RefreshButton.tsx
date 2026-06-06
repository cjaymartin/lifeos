import { useState, useCallback } from 'react';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';
import { watchRefreshJob, JOB_STATE_COLORS, type JobState } from '@/lib/client/job-watch';

export default function RefreshButton() {
  const [state, setState] = useState<JobState>('idle');

  const handleRefresh = useCallback(async () => {
    if (state === 'loading') return;
    setState('loading');

    const result = await watchRefreshJob({
      statusUrl: '/api/refresh/status',
      triggerUrl: '/api/refresh',
    });
    setState(result);
    if (result === 'done') setTimeout(() => window.location.reload(), 800);
  }, [state]);

  const label = { idle: 'Refresh', loading: 'Refreshing…', done: 'Done', error: 'Failed' }[state];

  return (
    <button
      onClick={handleRefresh}
      disabled={state === 'loading'}
      title={state === 'loading' ? 'Running /populate-daily…' : 'Refresh today\'s briefing'}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${JOB_STATE_COLORS[state]}`}
    >
      {state === 'loading' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
      {state === 'idle'    && <RefreshCw className="w-3.5 h-3.5" />}
      {state === 'done'    && <Check      className="w-3.5 h-3.5" />}
      {state === 'error'   && <AlertCircle className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </button>
  );
}
