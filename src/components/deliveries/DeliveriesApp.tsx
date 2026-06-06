import { useState, useCallback } from 'react';
import { RefreshCw, Check, AlertCircle, X, ExternalLink, Mail, Package, Undo2, ChevronRight } from 'lucide-react';
import type { Delivery, DeliveriesData, DeliveryStatus } from '@/lib/deliveries-types';
import { STATUS_ORDER, STATUS_LABELS } from '@/lib/deliveries-types';
import { watchRefreshJob, JOB_STATE_COLORS, type JobState } from '@/lib/client/job-watch';

const STATUS_BADGE: Record<DeliveryStatus, string> = {
  'out-for-delivery': 'bg-warning-subtle text-warning',
  shipped: 'bg-primary/10 text-primary',
  ordered: 'bg-muted text-muted-foreground',
  delivered: 'bg-emerald-500/10 text-emerald-500',
};

const CATEGORY_LABEL: Record<string, string> = {
  package: 'Package',
  food: 'Food',
  pharmacy: 'Pharmacy',
};

function dayDiff(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date = new Date(iso + 'T12:00:00'); date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

export function etaLabel(eta?: string): string | null {
  if (!eta) return null;
  const diff = dayDiff(eta);
  if (diff < 0) return 'Late?';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return new Date(eta + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  return new Date(eta + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Label for a past date (deliveredAt) — "today", "yesterday", or "Jun 3". */
export function pastLabel(iso: string): string {
  const diff = dayDiff(iso);
  if (diff >= 0) return 'today';
  if (diff === -1) return 'yesterday';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function lastSyncedLabel(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function DeliveryRow({ d, onDismiss, onRestore }: {
  d: Delivery;
  onDismiss?: (id: string) => void;
  onRestore?: (id: string) => void;
}) {
  const eta = etaLabel(d.eta);
  return (
    <li className={`group flex items-start gap-3 rounded-lg border border-border bg-card p-4 ${onRestore ? 'opacity-60 hover:opacity-100 transition-opacity' : ''}`}>
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        <Package className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{d.vendor}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[d.status]}`}>
            {STATUS_LABELS[d.status]}
          </span>
          {eta && d.status !== 'delivered' && (
            <span className={`text-xs font-medium ${eta === 'Today' ? 'text-warning' : 'text-muted-foreground'}`}>
              {eta}{d.etaWindow ? ` · ${d.etaWindow}` : ''}
            </span>
          )}
          {d.status === 'delivered' && d.deliveredAt && (
            <span className="text-xs text-muted-foreground">{pastLabel(d.deliveredAt)}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">{d.item}</p>
        <div className="flex flex-wrap items-center gap-3 pt-0.5">
          {d.carrier && (
            <span className="text-xs text-muted-foreground/70">{d.carrier}</span>
          )}
          <span className="text-xs text-muted-foreground/70">{CATEGORY_LABEL[d.category] ?? d.category}</span>
          {d.trackingUrl && (
            <a href={d.trackingUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="w-3 h-3" /> Track
            </a>
          )}
          {d.emailUrl && (
            <a href={d.emailUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Mail className="w-3 h-3" /> Email
            </a>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={() => onDismiss(d.id)}
          title="Dismiss this delivery"
          className="p-1 rounded text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label={`Dismiss ${d.vendor} delivery`}>
          <X className="w-4 h-4" />
        </button>
      )}
      {onRestore && (
        <button
          onClick={() => onRestore(d.id)}
          title="Restore this delivery"
          className="p-1 rounded text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label={`Restore ${d.vendor} delivery`}>
          <Undo2 className="w-4 h-4" />
        </button>
      )}
    </li>
  );
}

export default function DeliveriesApp({ initial }: { initial: DeliveriesData | null }) {
  const [data, setData] = useState<DeliveriesData | null>(initial);
  const [state, setState] = useState<JobState>('idle');
  const [showDismissed, setShowDismissed] = useState(false);

  const handleDismiss = useCallback(async (id: string) => {
    // Optimistic move to dismissed; the sync skill also honours dismissed.json
    setData(d => {
      if (!d) return d;
      const item = d.deliveries.find(x => x.id === id);
      return {
        ...d,
        deliveries: d.deliveries.filter(x => x.id !== id),
        dismissed: item ? [...(d.dismissed ?? []), item] : d.dismissed,
      };
    });
    try {
      await fetch('/api/deliveries/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    // Optimistic move back to active
    setData(d => {
      if (!d) return d;
      const item = (d.dismissed ?? []).find(x => x.id === id);
      return {
        ...d,
        deliveries: item ? [...d.deliveries, item] : d.deliveries,
        dismissed: (d.dismissed ?? []).filter(x => x.id !== id),
      };
    });
    try {
      await fetch('/api/deliveries/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }, []);

  const handleRefresh = useCallback(async () => {
    if (state === 'loading') return;
    setState('loading');

    const result = await watchRefreshJob({
      statusUrl: '/api/deliveries/status',
      triggerUrl: '/api/deliveries/refresh',
    });
    setState(result);
    if (result === 'done') setTimeout(() => window.location.reload(), 800);
  }, [state]);

  const label  = { idle: 'Refresh', loading: 'Scanning Gmail…', done: 'Done', error: 'Failed' }[state];
  const colors = JOB_STATE_COLORS[state];

  const deliveries = data?.deliveries ?? [];
  const dismissed = data?.dismissed ?? [];
  const groups = STATUS_ORDER
    .map(status => ({ status, items: deliveries.filter(d => d.status === status) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold text-foreground">Deliveries</h1>
          {data?.lastSynced && (
            <p className="text-xs text-muted-foreground">Last synced {lastSyncedLabel(data.lastSynced)}</p>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={state === 'loading'}
          title={state === 'loading' ? 'Running /populate-deliveries…' : 'Re-scan Gmail for deliveries'}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${colors}`}>
          {state === 'loading' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
          {state === 'idle'    && <RefreshCw className="w-3.5 h-3.5" />}
          {state === 'done'    && <Check      className="w-3.5 h-3.5" />}
          {state === 'error'   && <AlertCircle className="w-3.5 h-3.5" />}
          <span>{label}</span>
        </button>
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">
            {data ? 'No upcoming deliveries' : 'No delivery data yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {data
              ? 'Nothing in flight — hit Refresh to re-scan Gmail.'
              : 'Hit Refresh to scan Gmail for the first time.'}
          </p>
        </div>
      )}

      {groups.map(g => (
        <section key={g.status} className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {STATUS_LABELS[g.status]}
          </h2>
          <ul className="space-y-2">
            {g.items.map(d => <DeliveryRow key={d.id} d={d} onDismiss={handleDismiss} />)}
          </ul>
        </section>
      ))}

      {dismissed.length > 0 && (
        <section className="space-y-2 pt-2">
          <button
            onClick={() => setShowDismissed(s => !s)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showDismissed ? 'rotate-90' : ''}`} />
            Dismissed ({dismissed.length})
          </button>
          {showDismissed && (
            <ul className="space-y-2">
              {dismissed.map(d => <DeliveryRow key={d.id} d={d} onRestore={handleRestore} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
