import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, KeyRound } from 'lucide-react';
import AccountCard from './AccountCard';
import ExtensionCard from './ExtensionCard';
import { cn } from '@/lib/utils';
import { pollJob, type JobHandle } from '@/lib/client/job-watch';
import type { SettingsSnapshot } from '@/features/settings/ops/account-info';

// Tab shell — more settings tabs to come (passkeys, widgets, …). Add entries here.
const TABS = [
  { id: 'logins', label: 'Logins & Sessions' },
  { id: 'extension', label: 'Browser Extension' },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface Props {
  initial: SettingsSnapshot;
}

export default function SettingsApp({ initial }: Props) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(initial);
  const [tab, setTab] = useState<TabId>('logins');
  const pollHandle = useRef<JobHandle | null>(null);

  // Allow deep-linking a tab (e.g. the sidebar "Download Extension" →
  // /settings/logins?tab=extension).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q && TABS.some((t) => t.id === q)) setTab(q as TabId);
  }, []);

  const refresh = useCallback(async (): Promise<SettingsSnapshot | null> => {
    try {
      const res = await fetch('/api/settings/accounts');
      if (!res.ok) return null;
      const data = (await res.json()) as SettingsSnapshot;
      setSnapshot(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Poll every 4s while any job is in flight (MCP probes can take ~90s).
  const schedulePoll = useCallback(() => {
    pollHandle.current?.cancel();
    pollHandle.current = pollJob<SettingsSnapshot>({
      statusUrl: '/api/settings/accounts',
      firstDelayMs: 4000,
      intervalMs: 4000,
      maxAttempts: Number.POSITIVE_INFINITY,
      onStatus: setSnapshot,
      verdict: (s) => (s.accounts.some((a) => a.running) ? 'pending' : 'done'),
    });
  }, []);

  useEffect(() => {
    if (initial.accounts.some((a) => a.running)) schedulePoll();
    return () => pollHandle.current?.cancel();
  }, [initial, schedulePoll]);

  const onJobStarted = useCallback(
    (id: string) => {
      // optimistic: flip the card to running, then poll until the lock clears
      setSnapshot((s) => ({
        ...s,
        accounts: s.accounts.map((a) => (a.id === id ? { ...a, running: true } : a)),
      }));
      schedulePoll();
    },
    [schedulePoll],
  );

  const onChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {/* Tab bar */}
      <div className="mt-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'logins' && (
        <div className="mt-6 space-y-4">
          {!snapshot.secretsKeyConfigured && (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Secrets store is locked</p>
                <p className="mt-0.5 text-xs opacity-90">
                  Set <code className="font-mono">SECRETS_KEY</code> in <code className="font-mono">.env</code> to
                  enable saving tokens, credentials and cookies. Generate one with{' '}
                  <code className="font-mono">openssl rand -hex 32</code>, then restart.
                </p>
              </div>
            </div>
          )}

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="h-4 w-4" />
            Accounts LifeOS signs in to. Verify runs a live probe; retail sessions persist in a
            server-side Chrome profile — and cart links always work from your own device as a
            fallback.
          </p>

          {snapshot.accounts.map((a) => (
            <AccountCard key={a.id} account={a} onJobStarted={onJobStarted} onChanged={onChanged} />
          ))}
        </div>
      )}

      {tab === 'extension' && (
        <div className="mt-6">
          <ExtensionCard />
        </div>
      )}
    </div>
  );
}
