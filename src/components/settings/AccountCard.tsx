import { useState } from 'react';
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  ShieldX,
  ExternalLink,
  KeyRound,
  Cookie,
  LogIn,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import * as icons from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AccountInfo, VerifyState } from '@/features/settings/ops/settings-types';

function AccountIcon({ name }: { name: string }) {
  const Icon = (icons as unknown as Record<string, LucideIcon>)[name];
  return Icon ? <Icon size={20} /> : <KeyRound size={20} />;
}

const STATE_META: Record<VerifyState, { label: string; icon: LucideIcon; cls: string }> = {
  ok: { label: 'Connected', icon: ShieldCheck, cls: 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10' },
  failed: { label: 'Failed', icon: ShieldX, cls: 'border-destructive/30 text-destructive bg-destructive/10' },
  'needs-attention': { label: 'Needs attention', icon: ShieldAlert, cls: 'border-amber-500/30 text-amber-500 bg-amber-500/10' },
  unverified: { label: 'Unverified', icon: ShieldQuestion, cls: 'border-border text-muted-foreground bg-muted/30' },
};

function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type Panel = 'none' | 'token' | 'credentials' | 'cookies';

interface Props {
  account: AccountInfo;
  /** kick a poll cycle + optimistic running state */
  onJobStarted: (id: string) => void;
  /** full snapshot refresh after a synchronous action */
  onChanged: () => void;
}

export default function AccountCard({ account, onJobStarted, onChanged }: Props) {
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false); // synchronous actions (save token, import cookies)
  const [flash, setFlash] = useState<string | null>(null);

  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cookieJson, setCookieJson] = useState('');

  const meta = STATE_META[account.status.state];
  const StateIcon = meta.icon;
  const working = account.running || busy;

  async function post(path: string, body: object): Promise<{ ok: boolean; data: any }> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  const verify = async () => {
    setFlash(null);
    const { ok } = await post('/api/settings/verify', { accountId: account.id });
    if (ok) onJobStarted(account.id);
  };

  const relogin = async () => {
    setFlash(null);
    const { ok } = await post('/api/settings/relogin', { accountId: account.id });
    if (ok) onJobStarted(account.id);
  };

  const saveToken = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const { ok, data } = await post('/api/settings/token', { accountId: account.id, token });
      setFlash(data.detail ?? (ok ? 'Saved' : 'Failed'));
      if (ok) {
        setToken('');
        setPanel('none');
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const { ok, data } = await post('/api/settings/credentials', {
        accountId: account.id,
        username,
        password,
      });
      setFlash(ok ? 'Credentials saved — try Auto re-login' : (data.detail ?? 'Failed to save'));
      if (ok) {
        setPassword('');
        setPanel('none');
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const importCookies = async () => {
    setBusy(true);
    setFlash('Importing cookies and verifying the session — this takes ~20s…');
    try {
      const { data } = await post('/api/settings/cookies', {
        accountId: account.id,
        cookies: cookieJson,
      });
      setFlash(data.detail ?? 'Import finished');
      if (data.loggedIn) {
        setCookieJson('');
        setPanel('none');
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const togglePanel = (p: Panel) => setPanel(panel === p ? 'none' : p);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
              <AccountIcon name={account.icon} />
            </div>
            <div>
              <CardTitle className="text-base">{account.label}</CardTitle>
              <CardDescription className="text-xs">{account.description}</CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                meta.cls,
              )}
            >
              {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <StateIcon className="h-3 w-3" />}
              {working ? 'Working…' : meta.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              checked {timeAgo(account.status.checkedAt)}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {(account.status.detail || flash) && (
          <p className="text-xs text-muted-foreground">{flash ?? account.status.detail}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={verify} disabled={working}>
            <RefreshCw className={cn('h-3.5 w-3.5', account.running && 'animate-spin')} />
            Verify
          </Button>

          {account.kind === 'api-token' && (
            <Button size="sm" variant="outline" onClick={() => togglePanel('token')} disabled={busy}>
              <KeyRound className="h-3.5 w-3.5" />
              {account.hasToken ? 'Update token' : 'Set token'}
            </Button>
          )}

          {account.kind === 'browser-session' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={relogin}
                disabled={working || !account.hasCredentials}
                title={account.hasCredentials ? 'Re-login with stored credentials' : 'Save credentials first'}
              >
                <LogIn className="h-3.5 w-3.5" />
                Auto re-login
              </Button>
              <Button size="sm" variant="outline" onClick={() => togglePanel('credentials')} disabled={busy}>
                <KeyRound className="h-3.5 w-3.5" />
                {account.hasCredentials ? 'Update credentials' : 'Set credentials'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => togglePanel('cookies')} disabled={busy}>
                <Cookie className="h-3.5 w-3.5" />
                Paste cookies
              </Button>
            </>
          )}

          {account.repairUrl && (
            <Button size="sm" variant="ghost" asChild>
              <a href={account.repairUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                {account.repairLabel ?? 'Fix externally'}
              </a>
            </Button>
          )}
        </div>

        {panel === 'token' && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
            <Input
              type="password"
              placeholder="Paste API token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
            <Button size="sm" onClick={saveToken} disabled={busy || !token.trim()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Verify &amp; save
            </Button>
          </div>
        )}

        {panel === 'credentials' && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Stored AES-256 encrypted, used only for scripted re-login. If the site throws a
              CAPTCHA or 2FA wall, the run stops and you fall back to cookie paste.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder="Email / username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={saveCredentials} disabled={busy || !username.trim() || !password}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {panel === 'cookies' && (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              On any device where you're logged in to {account.label}, export cookies as JSON
              (e.g. the Cookie-Editor extension → Export → JSON) and paste them here. They're
              loaded into the server's Chrome profile and the session is verified immediately.
            </p>
            <textarea
              placeholder='[{"name":"...","value":"...","domain":".walmart.com",...}]'
              value={cookieJson}
              onChange={(e) => setCookieJson(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={importCookies} disabled={busy || !cookieJson.trim()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import &amp; verify
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
