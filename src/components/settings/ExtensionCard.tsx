import { useEffect, useState } from 'react';
import { Download, Puzzle, CheckCircle2, RefreshCw, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { detectExtension } from '@/lib/client/extension';

type Installed = string | null | undefined; // undefined = still detecting

export default function ExtensionCard() {
  const [installed, setInstalled] = useState<Installed>(undefined);
  const [current, setCurrent] = useState<string | null>(null);
  const [token, setToken] = useState<string>('');
  const [copied, setCopied] = useState<'token' | 'url' | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectExtension().then((v) => { if (!cancelled) setInstalled(v); });
    fetch('/api/extension/info').then(r => r.ok ? r.json() : null).then((d) => { if (!cancelled && d) setCurrent(d.version ?? null); }).catch(() => {});
    fetch('/api/grocery/ingest-token').then(r => r.ok ? r.json() : null).then((d) => { if (!cancelled && d) setToken(d.token ?? ''); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const updateAvailable = !!installed && !!current && installed !== current;
  const upToDate = !!installed && (!current || installed === current);

  const copy = async (what: 'token' | 'url', value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch {}
  };

  const StatusBadge = () => {
    if (installed === undefined) return <span className="text-xs text-muted-foreground">checking…</span>;
    if (upToDate) return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Installed{installed !== 'unknown' ? ` · v${installed}` : ''}
      </span>
    );
    if (updateAvailable) return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <RefreshCw className="h-3 w-3" /> Update available · v{current}
      </span>
    );
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Not installed</span>;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-foreground">
              <Puzzle className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">LifeOS Browser Extension</CardTitle>
              <CardDescription className="text-xs">
                Syncs your Walmart order history &amp; cart from your own session so cart-building is fast and accurate — no Gmail, no spidering.
              </CardDescription>
            </div>
          </div>
          <div className="shrink-0"><StatusBadge /></div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href="/api/extension/download">
              <Download className="h-3.5 w-3.5" />
              {updateAvailable ? 'Download update' : installed ? 'Re-download' : 'Download extension'}
            </a>
          </Button>
          {updateAvailable && (
            <span className="text-xs text-muted-foreground">After downloading, reload it in your browser's extensions page.</span>
          )}
        </div>

        {/* Setup values — minimal config */}
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Paste these into the extension's options:</p>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">LifeOS URL</span>
            <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{origin}</code>
            <Button size="sm" variant="outline" onClick={() => copy('url', origin)}>
              {copied === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Token</span>
            <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{token ? '••••••••••••••••' : '—'}</code>
            <Button size="sm" variant="outline" disabled={!token} onClick={() => copy('token', token)}>
              {copied === 'token' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Install steps */}
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Install (browsers require one manual step):</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Download above and unzip it.</li>
            <li>
              <strong>Chrome/Edge/Brave:</strong> open <code className="font-mono">chrome://extensions</code>, turn on
              Developer mode, click <em>Load unpacked</em>, pick the unzipped <code className="font-mono">lifeos-extension</code> folder.
            </li>
            <li>
              <strong>Firefox:</strong> open <code className="font-mono">about:debugging#/runtime/this-firefox</code>,
              click <em>Load Temporary Add-on</em>, pick <code className="font-mono">manifest.json</code> in the folder.
            </li>
            <li>Open the extension's options, paste the URL + token above, save.</li>
            <li>Visit <code className="font-mono">walmart.com/orders</code> while signed in — it syncs automatically.</li>
          </ol>
          <p className="opacity-80">Read-only — it never places orders, and no Walmart credentials reach LifeOS.</p>
        </div>
      </CardContent>
    </Card>
  );
}
