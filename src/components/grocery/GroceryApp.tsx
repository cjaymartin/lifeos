import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ShoppingCart, RefreshCw, Check, AlertCircle, X, ExternalLink, Mail, Star,
  ChevronRight, Plus, Loader2, Trash2, ListChecks, Search, Settings,
} from 'lucide-react';
import type {
  GroceryState, GroceryItem, Staple, StapleStatus, Retailer, CartsData, ProductRef, RestockAt,
} from '@/features/grocery/types';
import {
  DEFAULT_CATEGORIES, STAPLE_STATUS_LABELS, RETAILER_LABELS, RETAILER_CART_URLS,
  normalizeName, buildAddToCartUrl,
} from '@/features/grocery/types';
import { pollJob, watchFlagJob, type JobState, type JobHandle } from '@/lib/client/job-watch';
import { makeOptimistic } from '@/lib/client/stack-client';
import { groceryClient } from '@/features/grocery/client';

interface ProgressEvent { t: 'tool' | 'note' | 'result'; label: string }
interface BuildProgress { running: boolean; events: ProgressEvent[]; done: boolean; ok: boolean | null }

const COLLAPSE_KEY = 'grocery-collapsed';
const STAPLES_COLLAPSE_KEY = 'grocery-staples-collapsed';

const STAPLE_STATUS_STYLE: Record<StapleStatus, string> = {
  stocked: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
  low: 'bg-warning-subtle text-warning border-warning-border',
  out: 'bg-destructive/10 text-destructive border-destructive/30',
};

const NEXT_STATUS: Record<StapleStatus, StapleStatus> = {
  stocked: 'low', low: 'out', out: 'stocked',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'text-emerald-500',
  medium: 'text-warning',
  low: 'text-destructive',
};

/** Pull a number out of a display price like "$12.48" (null if none). */
function parsePrice(s?: string): number | null {
  const m = s?.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function loadCollapsed(key: string = COLLAPSE_KEY): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
}

/** Per-item settings cog: rename, always-buy-from, restock policy (staples),
 *  and the pinned-product link. */
function ItemSettings({ name, pin, onSavePin, onClearPin, buyFrom, onBuyFrom, restockAt, onRestockAt, onRename, defaultQty, onDefaultQty }: {
  name: string;
  pin?: ProductRef;
  onSavePin: (name: string, url: string) => Promise<string | null>;
  onClearPin: (name: string) => void;
  buyFrom?: Retailer;
  onBuyFrom: (retailer: Retailer | null) => void;
  /** Provided for staples only — undefined hides the restock control */
  restockAt?: RestockAt;
  onRestockAt?: (r: RestockAt) => void;
  onRename: (newName: string) => void;
  /** Preferred purchase count; null clears it */
  defaultQty?: number;
  onDefaultQty: (n: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rename, setRename] = useState(name);
  const [qty, setQty] = useState(defaultQty ? String(defaultQty) : '');

  const active = !!pin || !!buyFrom || (restockAt !== undefined && restockAt !== 'low') || !!defaultQty;

  const commitQty = () => {
    const n = parseInt(qty.trim(), 10);
    if (qty.trim() === '') { if (defaultQty) onDefaultQty(null); return; }
    if (Number.isFinite(n) && n >= 1 && n !== defaultQty) onDefaultQty(n);
  };

  const savePin = async () => {
    if (!url.trim()) return;
    const err = await onSavePin(name, url.trim());
    if (err) { setError(err); return; }
    setUrl(''); setError(null);
  };

  const saveRename = () => {
    const n = rename.trim();
    if (n && n !== name) { onRename(n); setOpen(false); }
  };

  const chip = (selected: boolean, label: string, onClick: () => void) => (
    <button key={label} onClick={onClick}
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
              selected ? 'bg-primary/10 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground'
            }`}>
      {label}
    </button>
  );

  return (
    <span className="relative">
      <button
        onClick={() => { setOpen(o => !o); setUrl(''); setError(null); setRename(name); setQty(defaultQty ? String(defaultQty) : ''); }}
        title={`Settings for ${name}${pin ? ` — pinned: ${pin.product ?? pin.productId}` : ''}${buyFrom ? ` — buys from ${RETAILER_LABELS[buyFrom]}` : ''}`}
        aria-label={`Settings for ${name}`}
        className={`p-1 rounded transition-colors ${
          active
            ? 'text-primary'
            : 'text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-primary'
        }`}>
        <Settings className="w-4 h-4" />
      </button>
      {open && (
        <span className="absolute right-0 top-full mt-1 z-20 w-72 rounded-lg border border-border bg-card shadow-lg p-3 block space-y-3">
          {/* Rename */}
          <span className="block space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name</span>
            <span className="flex items-center gap-1.5">
              <input
                value={rename}
                onChange={e => setRename(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setOpen(false); }}
                className="flex-1 min-w-0 bg-transparent border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-foreground/30"
              />
              {rename.trim() && rename.trim() !== name && (
                <button onClick={saveRename}
                        className="text-xs font-medium px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                  <Check className="w-3 h-3" />
                </button>
              )}
            </span>
          </span>

          {/* Always buy from */}
          <span className="block space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Always buy from</span>
            <span className="flex items-center gap-1.5">
              {chip(buyFrom === 'walmart', 'Walmart', () => onBuyFrom(buyFrom === 'walmart' ? null : 'walmart'))}
              {chip(buyFrom === 'amazon', 'Amazon', () => onBuyFrom(buyFrom === 'amazon' ? null : 'amazon'))}
              {chip(!buyFrom, 'Anywhere', () => onBuyFrom(null))}
            </span>
          </span>

          {/* Default quantity */}
          <span className="block space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Always buy</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number" min="1" inputMode="numeric"
                value={qty}
                onChange={e => setQty(e.target.value)}
                onBlur={commitQty}
                onKeyDown={e => { if (e.key === 'Enter') commitQty(); if (e.key === 'Escape') setOpen(false); }}
                placeholder="—"
                aria-label={`Default quantity for ${name}`}
                className="w-16 bg-transparent border border-border rounded-md px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
              />
              <span className="text-[11px] text-muted-foreground">per cart{defaultQty ? '' : ' (defaults to 1)'}</span>
            </span>
          </span>

          {/* Restock policy — staples only */}
          {restockAt !== undefined && onRestockAt && (
            <span className="block space-y-1">
              <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Re-add to list when</span>
              <span className="flex items-center gap-1.5">
                {chip(restockAt === 'low', 'Low', () => onRestockAt('low'))}
                {chip(restockAt === 'out', 'Out', () => onRestockAt('out'))}
                {chip(restockAt === 'never', 'Never', () => onRestockAt('never'))}
              </span>
            </span>
          )}

          {/* Pinned product */}
          <span className="block space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Preferred product</span>
            {pin?.productUrl && (
              <a href={pin.productUrl} target="_blank" rel="noopener noreferrer"
                 className="block text-xs text-primary hover:underline truncate">
                {pin.product ?? pin.productUrl}
              </a>
            )}
            <input
              value={url}
              onChange={e => { setUrl(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') savePin(); if (e.key === 'Escape') setOpen(false); }}
              placeholder="Paste walmart.com or amazon.com product link…"
              className="w-full bg-transparent border border-border rounded-md px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/30"
            />
            {error && <span className="block text-xs text-destructive">{error}</span>}
            <span className="flex items-center gap-2">
              {url.trim() && (
                <button onClick={savePin}
                        className="text-xs font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                  Save pin
                </button>
              )}
              {pin && (
                <button onClick={() => { onClearPin(name); }}
                        className="text-xs px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-destructive transition-colors">
                  Unpin
                </button>
              )}
              <button onClick={() => setOpen(false)}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors">
                Close
              </button>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Small emerald "in cart" chip — shown when the built cart says this item
 *  was already pushed to a retailer cart via the Add-to-cart button. */
function InCartBadge({ retailer }: { retailer: string }) {
  return (
    <span
      title={`Already added to your ${retailer} cart`}
      className="ml-2 px-1.5 py-px rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-medium whitespace-nowrap">
      <ShoppingCart className="inline w-2.5 h-2.5 mr-0.5 align-text-top" />in cart
    </span>
  );
}

function ItemRow({ item, onToggle, onStar, onDelete, productRef, onPinSave, onPinClear, onRename, onBuyFrom, onDefaultQty, selecting, selected, onSelect, inCart }: {
  item: GroceryItem;
  onToggle: (item: GroceryItem) => void;
  onStar: (item: GroceryItem) => void;
  onDelete: (item: GroceryItem) => void;
  productRef?: ProductRef;
  onPinSave: (name: string, url: string) => Promise<string | null>;
  onPinClear: (name: string) => void;
  onRename: (item: GroceryItem, name: string) => void;
  onBuyFrom: (item: GroceryItem, retailer: Retailer | null) => void;
  onDefaultQty: (item: GroceryItem, n: number | null) => void;
  selecting: boolean;
  selected: boolean;
  onSelect: (item: GroceryItem) => void;
  /** Retailer label when this item is already in a retailer cart */
  inCart?: string;
}) {
  // Selection mode: the row becomes a cart-include toggle (checked items can't
  // go in a cart, so they render dimmed and inert)
  if (selecting) {
    // Checked items can't go in a cart; in-cart items are already there
    const selectable = !item.checked && !inCart;
    return (
      <li className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
        selectable ? 'cursor-pointer hover:bg-accent/30' : 'opacity-40'
      }`}
          onClick={() => selectable && onSelect(item)}>
        <span className={`shrink-0 w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors ${
          selectable && selected ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
        }`}>
          {selectable && selected && <ShoppingCart className="w-3 h-3" />}
        </span>
        <span className={`flex-1 min-w-0 text-sm ${item.checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {item.name}
          {item.quantity && <span className="ml-2 text-xs text-muted-foreground">× {item.quantity}</span>}
          {inCart && <InCartBadge retailer={inCart} />}
        </span>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent/30 transition-colors">
      <button
        onClick={() => onToggle(item)}
        aria-label={item.checked ? `Uncheck ${item.name}` : `Check off ${item.name}`}
        className={`shrink-0 w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors ${
          item.checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-border hover:border-foreground/40'
        }`}>
        {item.checked && <Check className="w-3 h-3" />}
      </button>
      <button onClick={() => onToggle(item)} className="flex-1 min-w-0 text-left">
        <span className={`text-sm ${item.checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {item.name}
        </span>
        {item.quantity && (
          <span className="ml-2 text-xs text-muted-foreground">× {item.quantity}</span>
        )}
        {item.note && (
          <span className="ml-2 text-xs text-muted-foreground/70 italic">{item.note}</span>
        )}
        {inCart && <InCartBadge retailer={inCart} />}
        {item.categoryConfirmed === false && (
          <span className="ml-2 text-xs text-muted-foreground/50" title="Categorizing…">
            <Loader2 className="inline w-3 h-3 animate-spin" />
          </span>
        )}
      </button>
      <ItemSettings
        name={item.name} pin={productRef}
        onSavePin={onPinSave} onClearPin={onPinClear}
        buyFrom={item.buyFrom} onBuyFrom={r => onBuyFrom(item, r)}
        defaultQty={item.defaultQty} onDefaultQty={n => onDefaultQty(item, n)}
        onRename={n => onRename(item, n)} />
      <button
        onClick={() => onStar(item)}
        title={item.staple ? 'Remove from staples' : 'Mark as a staple (auto re-adds when low/out)'}
        aria-label={item.staple ? `Unstar ${item.name}` : `Star ${item.name} as staple`}
        className={`p-1 rounded transition-colors ${
          item.staple
            ? 'text-warning'
            : 'text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-warning'
        }`}>
        <Star className="w-4 h-4" fill={item.staple ? 'currentColor' : 'none'} />
      </button>
      <button
        onClick={() => onDelete(item)}
        title="Remove from list"
        aria-label={`Remove ${item.name}`}
        className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-destructive transition-colors">
        <X className="w-4 h-4" />
      </button>
    </li>
  );
}

export default function GroceryApp({ initial }: { initial: GroceryState }) {
  const [state, setState] = useState<GroceryState>(initial);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showStaples, setShowStaples] = useState(false);
  const [stapleInput, setStapleInput] = useState('');
  const [stapleQuery, setStapleQuery] = useState('');
  const [stapleFilter, setStapleFilter] = useState<'all' | StapleStatus>('all');
  const [stapleCollapsed, setStapleCollapsed] = useState<Record<string, boolean>>({});
  const [buildState, setBuildState] = useState<JobState>('idle');
  const [scanState, setScanState] = useState<JobState>('idle');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [buildModal, setBuildModal] = useState(false);
  // Post-handoff reconciliation: which retailer's cart we're confirming, and
  // the set of lines the user says actually landed (pre-checked, they uncheck
  // the misses).
  const [reconcile, setReconcile] = useState<Retailer | null>(null);
  const [reconcileChecked, setReconcileChecked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [instantCount, setInstantCount] = useState(0);
  const [buildElapsed, setBuildElapsed] = useState(0);
  const buildPollRef = useRef<JobHandle | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(loadCollapsed());
    setStapleCollapsed(loadCollapsed(STAPLES_COLLAPSE_KEY));
  }, []);
  useEffect(() => () => {
    buildPollRef.current?.cancel();
  }, []);

  // Elapsed clock + feed auto-scroll while a build runs
  useEffect(() => {
    if (buildState !== 'loading') return;
    setBuildElapsed(0);
    const t = setInterval(() => setBuildElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [buildState]);
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [progress]);

  const refetch = useCallback(async () => {
    try {
      setState(await groceryClient.state());
    } catch {}
  }, []);

  // Optimistic cycle: apply locally, call the typed client, refetch on
  // failure (rollback) — and on success too where server-side ripple effects
  // need picking up (sync: 'always').
  const mutate = useMemo(
    () => makeOptimistic<GroceryState>({ apply: (u) => setState(u), refetch }),
    [refetch],
  );

  const toggleCollapsed = (cat: string) => {
    setCollapsed(c => {
      const next = { ...c, [cat]: !c[cat] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  /* ── Items ─────────────────────────────────────────────────────────── */

  // Poll while the categorize micro-agent runs, then refetch to pick up categories
  const pollCategorize = useCallback(() => {
    void watchFlagJob({
      statusUrl: '/api/grocery/status',
      flag: 'categorizing',
      firstDelayMs: 5000,
      intervalMs: 4000,
      maxAttempts: 20, // ~80s max
      minAttempts: 1,
    }).then(result => { if (result === 'done') void refetch(); });
  }, [refetch]);

  const addItem = useCallback(async () => {
    const name = input.trim();
    if (!name) return;
    setInput('');
    // Optimistic placeholder; the server response replaces it
    const tempId = `temp-${Date.now()}`;
    setState(s => ({
      ...s,
      items: [...s.items, {
        id: tempId, name, category: 'Other', categoryConfirmed: false,
        checked: false, addedAt: new Date().toISOString(), source: 'manual' as const,
      }],
    }));
    try {
      const { added, categorizing } = await groceryClient.addItem(name);
      setState(s => ({
        ...s,
        items: [...s.items.filter(i => i.id !== tempId), ...added],
      }));
      if (categorizing) pollCategorize();
    } catch {
      setState(s => ({ ...s, items: s.items.filter(i => i.id !== tempId) }));
    }
  }, [input, pollCategorize]);

  const handleToggle = useCallback((item: GroceryItem) =>
    mutate(
      s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i) }),
      () => groceryClient.patchItem(item.id, { checked: !item.checked }),
    ), [mutate]);

  const handleStar = useCallback((item: GroceryItem) => {
    const staple = !item.staple;
    return mutate(
      s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, staple } : i) }),
      () => groceryClient.patchItem(item.id, { staple }),
      { sync: 'always' }, // pick up the staples.json change
    );
  }, [mutate]);

  const renameItem = useCallback((item: GroceryItem, name: string) =>
    mutate(
      s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, name } : i) }),
      () => groceryClient.patchItem(item.id, { name }),
      { sync: 'always' }, // staple/pin renames ride along server-side
    ), [mutate]);

  const setItemBuyFrom = useCallback((item: GroceryItem, retailer: Retailer | null) =>
    mutate(
      s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, buyFrom: retailer ?? undefined } : i) }),
      () => groceryClient.patchItem(item.id, { buyFrom: retailer }),
      { sync: 'always' },
    ), [mutate]);

  const setItemDefaultQty = useCallback((item: GroceryItem, n: number | null) =>
    mutate(
      s => ({ ...s, items: s.items.map(i => i.id === item.id ? { ...i, defaultQty: n ?? undefined } : i) }),
      () => groceryClient.patchItem(item.id, { defaultQty: n }),
      { sync: 'always' }, // mirrors onto a matching staple server-side
    ), [mutate]);

  /** Generic staple PATCH + refetch (rename, buyFrom, restockAt). */
  const patchStaple = useCallback((id: string, patch: Record<string, unknown>) =>
    mutate(s => s, () => groceryClient.patchStaple(id, patch), { sync: 'always' }), [mutate]);

  const handleDelete = useCallback((item: GroceryItem) =>
    mutate(
      s => ({ ...s, items: s.items.filter(i => i.id !== item.id) }),
      () => groceryClient.deleteItem(item.id),
    ), [mutate]);

  /* ── Staples ───────────────────────────────────────────────────────── */

  const cycleStaple = useCallback((staple: Staple) => {
    const status = NEXT_STATUS[staple.status];
    return mutate(
      s => ({ ...s, staples: s.staples.map(x => x.id === staple.id ? { ...x, status } : x) }),
      () => groceryClient.patchStaple(staple.id, { status }),
      { sync: 'always' }, // low/out may have auto-added a list item
    );
  }, [mutate]);

  const addStaple = useCallback(async () => {
    const name = stapleInput.trim();
    if (!name) return;
    setStapleInput('');
    await mutate(s => s, () => groceryClient.addStaple(name), { sync: 'always' });
  }, [stapleInput, mutate]);

  const setStapleCategory = useCallback((staple: Staple, category: string) =>
    mutate(
      s => ({ ...s, staples: s.staples.map(x => x.id === staple.id ? { ...x, category } : x) }),
      () => groceryClient.patchStaple(staple.id, { category }),
      { sync: 'always' }, // matching list items get re-filed too
    ), [mutate]);

  const toggleStapleCollapsed = useCallback((cat: string) => {
    setStapleCollapsed(c => {
      const next = { ...c, [cat]: !c[cat] };
      try { localStorage.setItem(STAPLES_COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const deleteStaple = useCallback((staple: Staple) =>
    mutate(
      s => ({ ...s, staples: s.staples.filter(x => x.id !== staple.id) }),
      () => groceryClient.deleteStaple(staple.id),
    ), [mutate]);

  /* ── Build carts (live-progress modal) ─────────────────────────────── */

  const startBuild = useCallback(async (itemIds?: string[]) => {
    if (buildState === 'loading') { setBuildModal(true); return; }
    setBuildState('loading');
    setProgress(null);
    setInstantCount(0);
    try {
      let instant = 0, queued = 0;
      try {
        const r = await groceryClient.buildCarts(itemIds);
        instant = r.instant ?? 0;
        queued = r.queued ?? 0;
      } catch {
        setBuildState('error'); setBuildModal(true); return;
      }
      setInstantCount(instant);

      if (queued === 0) {
        // Everything resolved from the product memory — no agent, no modal
        await refetch();
        setBuildState('done');
        setTimeout(() => setBuildState('idle'), 2500);
        return;
      }

      setBuildModal(true);
      if (instant > 0) refetch(); // show the instant lines right away

      let last: BuildProgress | null = null;
      buildPollRef.current = pollJob<BuildProgress>({
        statusUrl: '/api/grocery/build-progress',
        firstDelayMs: 1500,
        intervalMs: 2000,
        maxAttempts: 200, // ~6.5 min at 2s
        fetchError: 'continue', // a blip mid-build keeps the feed alive
        onStatus: (p) => { last = p; setProgress(p); },
        verdict: (p, { attempts }) =>
          p.done || (!p.running && attempts > 4) ? 'done' : 'pending',
      });
      const result = await buildPollRef.current.result;
      if (result === 'error') { setBuildState('error'); return; }
      await refetch();
      setBuildState(last !== null && (last as BuildProgress).ok === false ? 'error' : 'done');
      setTimeout(() => setBuildState('idle'), 2500);
    } catch {
      setBuildState('error');
    }
  }, [buildState, refetch]);

  /* ── Purchase scan ─────────────────────────────────────────────────── */

  const runJob = useCallback(async (
    kind: 'build-carts' | 'purchase-scan',
    setJobState: (s: JobState) => void,
    runningKey: 'building' | 'scanning',
    body?: unknown,
  ) => {
    setJobState('loading');
    try {
      try {
        await groceryClient.triggerJob(kind);
      } catch { setJobState('error'); return; }

      const result = await watchFlagJob({
        statusUrl: '/api/grocery/status',
        flag: runningKey,
        maxAttempts: 75, // 5 min
      });
      if (result === 'error') { setJobState('error'); return; }
      await refetch();
      setJobState('done');
      setTimeout(() => setJobState('idle'), 2500);
    } catch { setJobState('error'); }
  }, [refetch]);

  /* ── Product pins ──────────────────────────────────────────────────── */

  const pinSave = useCallback(async (name: string, url: string): Promise<string | null> => {
    try {
      await groceryClient.pinProduct(name, url);
      await refetch();
      return null;
    } catch (e) {
      if (e instanceof TypeError) return 'Could not reach the server.';
      const msg = e instanceof Error ? e.message : '';
      return msg && !msg.startsWith('HTTP') ? msg : 'Could not save that link.';
    }
  }, [refetch]);

  const pinClear = useCallback((name: string) =>
    mutate(s => s, () => groceryClient.clearPin(name), { sync: 'always' }), [mutate]);

  /* ── Cart selection mode ───────────────────────────────────────────── */

  const enterSelecting = useCallback(() => {
    // Start empty — the user picks exactly what should go in the cart
    setSelected(new Set());
    setSelecting(true);
  }, []);

  const toggleSelected = useCallback((item: GroceryItem) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
      return next;
    });
  }, []);

  const removeCartItem = useCallback(async (retailer: Retailer, itemId: string) => {
    // Optimistic: drop the match locally (cartUrl is rebuilt server-side)
    await mutate(s => {
      if (!s.carts) return s;
      const carts = s.carts.carts
        .map(c => c.retailer === retailer ? { ...c, items: c.items.filter(m => m.itemId !== itemId) } : c)
        .filter(c => c.items.length > 0 || c.unmatched.length > 0);
      return { ...s, carts: carts.length ? { ...s.carts, carts } : null };
    }, () => groceryClient.removeCartItem(retailer, itemId),
       { sync: 'always' }); // pick up the rebuilt cartUrl
  }, [mutate]);

  const dismissCart = useCallback((retailer: Retailer) =>
    mutate(s => {
      if (!s.carts) return s;
      const carts = s.carts.carts.filter(c => c.retailer !== retailer);
      return { ...s, carts: carts.length ? { ...s.carts, carts } : null };
    }, () => groceryClient.dismissCart(retailer)), [mutate]);

  /** Forget the whole cart's added-state (the add didn't go through at all —
   *  bot check, login wall, emptied cart) so the full add is offered again. */
  const resetCartAdded = useCallback((retailer: Retailer) =>
    mutate(s => {
      if (!s.carts) return s;
      return {
        ...s,
        carts: {
          ...s.carts,
          carts: s.carts.carts.map(c => c.retailer === retailer
            ? { ...c, items: c.items.map(m => m.productId ? { ...m, addedQty: undefined } : m) }
            : c),
        },
      };
    }, () => groceryClient.setCartAdded(retailer, false)), [mutate]);

  /** Open the post-handoff reconciliation panel for a retailer cart, with every
   *  matched line pre-checked (the user unchecks anything that didn't land). */
  const openReconcile = useCallback((retailer: Retailer) => {
    const cart = state.carts?.carts.find(c => c.retailer === retailer);
    if (!cart) return;
    setReconcileChecked(new Set(cart.items.filter(m => m.productId).map(m => m.itemId)));
    setReconcile(retailer);
  }, [state.carts]);

  const toggleReconcile = useCallback((itemId: string) => {
    setReconcileChecked(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }, []);

  /** Commit the reconciliation: confirmed lines get addedQty=qty (excluded from
   *  the next build → no duplicate re-adds); the rest reset to pending. */
  const submitReconcile = useCallback(async (retailer: Retailer) => {
    const ids = [...reconcileChecked];
    setReconcile(null);
    const added = new Set(ids);
    await mutate(s => {
      if (!s.carts) return s;
      return {
        ...s,
        carts: {
          ...s.carts,
          carts: s.carts.carts.map(c => c.retailer === retailer
            ? {
                ...c,
                items: c.items.map(m => m.productId
                  ? (added.has(m.itemId) ? { ...m, addedQty: m.qty ?? 1 } : { ...m, addedQty: undefined })
                  : m),
              }
            : c),
        },
      };
    }, () => groceryClient.reconcileCart(retailer, ids));
  }, [reconcileChecked, mutate]);

  const checkoutCart = useCallback((retailer: Retailer) =>
    mutate(s => s, () => groceryClient.checkout({ retailer }), { sync: 'always' }), [mutate]);

  const clearChecked = useCallback(async () => {
    const ids = state.items.filter(i => i.checked).map(i => i.id);
    if (ids.length === 0) return;
    await mutate(
      s => ({ ...s, items: s.items.filter(i => !i.checked) }),
      () => groceryClient.checkout({ itemIds: ids }),
      { sync: 'always' },
    );
  }, [state.items, mutate]);

  /* ── Render ────────────────────────────────────────────────────────── */

  const items = state.items;

  // itemId → retailer label for items LifeOS believes are already in a real
  // retailer cart (their cart line was fully pushed via the Add-to-cart button)
  const inCartById: Record<string, string> = {};
  for (const cart of state.carts?.carts ?? []) {
    for (const m of cart.items) {
      if (m.productId && (m.addedQty ?? 0) >= (m.qty ?? 1)) {
        inCartById[m.itemId] = cart.label || RETAILER_LABELS[cart.retailer];
      }
    }
  }

  const checkedCount = items.filter(i => i.checked).length;
  const uncheckedCount = items.length - checkedCount;
  // Items a cart build could actually act on (not checked, not already in a cart)
  const buildableCount = items.filter(i => !i.checked && !inCartById[i.id]).length;
  const categories = DEFAULT_CATEGORIES
    .map(cat => ({
      cat,
      items: items
        .filter(i => i.category === cat)
        .sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name)),
    }))
    .filter(g => g.items.length > 0);

  const buildLabel = { idle: 'Build Carts', loading: 'Building carts…', done: 'Carts ready', error: 'Failed' }[buildState];
  const scanLabel = { idle: 'Scan purchases', loading: 'Scanning Gmail…', done: 'Done', error: 'Failed' }[scanState];
  const jobColors = (s: JobState) => ({
    idle: 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/30',
    loading: 'border-border text-muted-foreground cursor-wait',
    done: 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10',
    error: 'border-destructive/30 text-destructive bg-destructive/10',
  })[s];

  const carts: CartsData | null = state.carts;

  const lastEventIdx = (progress?.events.length ?? 0) - 1;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      {/* Build-cart progress modal */}
      {buildModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
          onClick={() => setBuildModal(false)}>
          <div
            className="w-full max-w-md max-h-[80vh] flex flex-col rounded-xl border border-border bg-card shadow-xl"
            role="dialog" aria-label="Cart build progress"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
              {buildState === 'loading' && <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
              {buildState === 'done' && <Check className="w-4 h-4 text-emerald-500" />}
              {buildState === 'error' && <AlertCircle className="w-4 h-4 text-destructive" />}
              {buildState === 'idle' && <ShoppingCart className="w-4 h-4 text-muted-foreground" />}
              <span className="text-sm font-medium text-foreground">
                {buildState === 'loading' ? 'Building your cart…'
                  : buildState === 'error' ? 'Cart build failed'
                  : 'Cart build'}
              </span>
              {buildState === 'loading' && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.floor(buildElapsed / 60)}:{String(buildElapsed % 60).padStart(2, '0')}
                </span>
              )}
              <button
                onClick={() => setBuildModal(false)}
                aria-label="Close progress"
                className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live feed */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5 min-h-[10rem]">
              {instantCount > 0 && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-emerald-500">
                  <Check className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{instantCount} item{instantCount === 1 ? '' : 's'} added instantly from your saved products — researching the rest…</span>
                </p>
              )}
              {(!progress || progress.events.length === 0) && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Starting the cart agent (reads your pins and order history first)…
                </p>
              )}
              {progress?.events.map((e, i) => {
                const isLast = i === lastEventIdx && buildState === 'loading';
                return (
                  <p key={i} className={`flex items-start gap-2 text-xs leading-relaxed ${
                    e.t === 'result'
                      ? (progress.ok === false ? 'text-destructive font-medium' : 'text-emerald-500 font-medium')
                      : e.t === 'note' ? 'text-muted-foreground/70 italic'
                      : isLast ? 'text-foreground' : 'text-muted-foreground'
                  }`}>
                    <span className="mt-0.5 shrink-0">
                      {e.t === 'result'
                        ? (progress.ok === false ? <AlertCircle className="w-3 h-3" /> : <Check className="w-3 h-3" />)
                        : isLast
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <ChevronRight className="w-3 h-3 opacity-50" />}
                    </span>
                    <span className="min-w-0">{e.label}</span>
                  </p>
                );
              })}
              <div ref={feedEndRef} />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
              <span className="text-[11px] text-muted-foreground/60">
                Links only — nothing is ever purchased for you.
              </span>
              <button
                onClick={() => setBuildModal(false)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-opacity ${
                  buildState === 'loading'
                    ? 'border border-border text-muted-foreground hover:text-foreground'
                    : 'bg-primary text-primary-foreground hover:opacity-90'
                }`}>
                {buildState === 'loading' ? 'Hide (keeps building)' : 'Show cart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold text-foreground">Groceries</h1>
          <p className="text-xs text-muted-foreground">
            {uncheckedCount} item{uncheckedCount === 1 ? '' : 's'} to get
            {checkedCount > 0 && ` · ${checkedCount} checked`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runJob('purchase-scan', setScanState, 'scanning')}
            disabled={scanState === 'loading'}
            title="Scan Gmail for Walmart/Amazon order confirmations and clear purchased items"
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${jobColors(scanState)}`}>
            {scanState === 'loading' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
            <span>{scanLabel}</span>
          </button>
          <button
            onClick={enterSelecting}
            disabled={selecting || buildState === 'loading' || buildableCount === 0}
            title="Pick which items go in the cart"
            aria-label="Pick items for the cart"
            className="flex items-center text-xs px-2 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-50">
            <ListChecks className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => startBuild()}
            disabled={selecting || buildState === 'loading' || buildableCount === 0}
            title="Build a Walmart cart for everything on the list not already in a cart (reorders your usual products; never purchases)"
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${jobColors(buildState)}`}>
            {buildState === 'loading' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            {buildState === 'idle' && <ShoppingCart className="w-3.5 h-3.5" />}
            {buildState === 'done' && <Check className="w-3.5 h-3.5" />}
            {buildState === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
            <span>{buildLabel}</span>
          </button>
        </div>
      </div>

      {/* Cart selection bar */}
      {selecting && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-xs text-foreground">
            <ShoppingCart className="inline w-3.5 h-3.5 mr-1.5 align-text-bottom" />
            {selected.size} of {buildableCount} item{buildableCount === 1 ? '' : 's'} picked — tap rows to toggle
          </span>
          <span className="flex items-center gap-2">
            <button
              onClick={() => { setSelecting(false); startBuild([...selected]); }}
              disabled={selected.size === 0}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
              Build cart ({selected.size})
            </button>
            <button
              onClick={() => setSelecting(false)}
              className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </span>
        </div>
      )}

      {/* Quick add */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-foreground/30 transition-colors">
        <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
          placeholder="Add an item — try “2 milk” or “1 lb ground beef”"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {input.trim() && (
          <button onClick={addItem} className="text-xs font-medium text-primary hover:underline shrink-0">
            Add
          </button>
        )}
      </div>

      {/* Carts panel */}
      {carts && carts.carts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Built carts
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {carts.carts.map(cart => {
              // Lines not yet pushed to the retailer cart (or with a qty bump)
              const pending = cart.items.filter(
                (m): m is typeof m & { productId: string } =>
                  !!m.productId && (m.qty ?? 1) > (m.addedQty ?? 0),
              );
              const addUrl = buildAddToCartUrl(
                cart.retailer,
                pending.map(m => ({ productId: m.productId, qty: (m.qty ?? 1) - (m.addedQty ?? 0) })),
              );
              // Estimated cart total from the matched lines' prices
              const matched = cart.items.filter(m => m.productId);
              const estTotal = matched.reduce((sum, m) => sum + (parsePrice(m.price) ?? 0), 0);
              const unpriced = matched.filter(m => parsePrice(m.price) === null).length;
              const reconciling = reconcile === cart.retailer;
              return (
              <div key={cart.retailer} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {cart.label || RETAILER_LABELS[cart.retailer]}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {cart.items.length} matched{cart.unmatched.length > 0 ? ` · ${cart.unmatched.length} not found` : ''}
                    </span>
                    <button
                      onClick={() => dismissCart(cart.retailer)}
                      title="Dismiss this cart (keeps the items on your list)"
                      aria-label={`Dismiss ${cart.label || cart.retailer} cart`}
                      className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {cart.items.map(m => (
                    <li key={m.itemId} className="group/cartitem flex items-start gap-1 text-xs leading-relaxed">
                      <span className="flex-1 min-w-0">
                        <span className="text-foreground">{m.name}</span>
                        {m.product && (
                          <span className="text-muted-foreground"> → {m.product}{m.price ? ` (${m.price})` : ''}</span>
                        )}
                        {m.source === 'reorder' && (
                          <span className="ml-1.5 px-1.5 py-px rounded-full bg-primary/10 text-primary text-[10px] font-medium">reorder</span>
                        )}
                        {m.productId && (m.addedQty ?? 0) >= (m.qty ?? 1) && (
                          <span className="ml-1.5 px-1.5 py-px rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-medium">
                            <Check className="inline w-2.5 h-2.5 mr-0.5 align-text-top" />in cart
                          </span>
                        )}
                        {m.confidence && (
                          <span className={`ml-1 ${CONFIDENCE_STYLE[m.confidence] ?? ''}`}>•</span>
                        )}
                        {m.productUrl && (
                          <a href={m.productUrl} target="_blank" rel="noopener noreferrer"
                             className="ml-1.5 inline-flex items-center text-primary hover:underline align-middle">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </span>
                      <button
                        onClick={() => removeCartItem(cart.retailer, m.itemId)}
                        title="Remove from this cart (stays on your list)"
                        aria-label={`Remove ${m.name} from ${cart.label || cart.retailer} cart`}
                        className="shrink-0 p-0.5 rounded text-muted-foreground/0 group-hover/cartitem:text-muted-foreground/40 hover:!text-destructive transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
                {cart.unmatched.length > 0 && (
                  <p className="text-xs text-warning">
                    <AlertCircle className="inline w-3 h-3 mr-1 align-text-top" />
                    Needs attention — not found: {cart.unmatched.join(', ')}
                  </p>
                )}
                {cart.notes && <p className="text-xs text-muted-foreground/70 italic">{cart.notes}</p>}
                {matched.length > 0 && (
                  <p className="text-[11px] text-muted-foreground/70">
                    {unpriced > 0 ? '≥ ' : 'Est. '}${estTotal.toFixed(2)} · before tax &amp; fees
                    {unpriced > 0 && ` · ${unpriced} unpriced`}
                  </p>
                )}

                {reconciling ? (
                  /* Post-handoff reconciliation — the honest "what landed" step */
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-[11px] font-medium text-foreground">
                      Which items made it into your {cart.label || RETAILER_LABELS[cart.retailer]} cart? Uncheck anything that didn’t.
                    </p>
                    <ul className="space-y-1">
                      {cart.items.filter(m => m.productId).map(m => {
                        const on = reconcileChecked.has(m.itemId);
                        return (
                          <li key={m.itemId}>
                            <button
                              onClick={() => toggleReconcile(m.itemId)}
                              className="flex items-center gap-2 w-full text-left text-xs">
                              <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                on ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
                              }`}>
                                {on && <Check className="w-3 h-3" />}
                              </span>
                              <span className={on ? 'text-foreground' : 'text-muted-foreground line-through'}>{m.name}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => submitReconcile(cart.retailer)}
                        className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                        Confirm cart
                      </button>
                      <button
                        onClick={() => setReconcile(null)}
                        className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 pt-1">
                    {pending.length > 0 && addUrl ? (
                      <a href={addUrl} target="_blank" rel="noopener noreferrer"
                         // Opens the bulk add link in a new tab; the reconcile panel
                         // (opened here) is how we learn what actually landed. No
                         // deferral needed — addedQty changes only on confirm, so the
                         // anchor isn't swapped mid-click.
                         onClick={() => openReconcile(cart.retailer)}
                         title={`Adds ${pending.length} item${pending.length === 1 ? '' : 's'} to your ${cart.label || RETAILER_LABELS[cart.retailer]} cart, then asks which ones landed`}
                         className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
                        <ShoppingCart className="w-3.5 h-3.5" /> Add to cart ({pending.length})
                      </a>
                    ) : (
                      <>
                        <a href={RETAILER_CART_URLS[cart.retailer]} target="_blank" rel="noopener noreferrer"
                           title="Everything's already in the retailer cart — this just opens it (adds nothing)"
                           className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" /> View cart
                        </a>
                        <button
                          onClick={() => openReconcile(cart.retailer)}
                          title="Fix what's actually in the cart"
                          className="text-xs px-2 py-1.5 rounded-md text-muted-foreground/60 hover:text-foreground transition-colors">
                          Edit
                        </button>
                        <button
                          onClick={() => resetCartAdded(cart.retailer)}
                          title="Didn't actually make it into the cart? Reset so you can add again"
                          className="text-xs px-2 py-1.5 rounded-md text-muted-foreground/60 hover:text-foreground transition-colors">
                          Re-add
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => checkoutCart(cart.retailer)}
                      title="Mark these items purchased — removes them from the list and restocks staples"
                      className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors">
                      I checked out
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            Carts are pre-filled only — review and place the order yourself. Nothing is ever purchased automatically.
          </p>
        </section>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-2">
          <p className="text-sm font-medium text-foreground">Your list is empty</p>
          <p className="text-xs text-muted-foreground">
            Type an item above, mark a staple as low, or ask the assistant to add ingredients from a recipe.
          </p>
        </div>
      )}

      {/* Category accordions */}
      {categories.map(({ cat, items: catItems }) => {
        const isCollapsed = !!collapsed[cat];
        const remaining = catItems.filter(i => !i.checked).length;
        return (
          <section key={cat} className="rounded-xl border border-border bg-card overflow-hidden">
            <button
              onClick={() => toggleCollapsed(cat)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent/30 transition-colors">
              <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
              <span className="text-sm font-medium text-foreground">{cat}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {remaining}{catItems.length !== remaining ? ` / ${catItems.length}` : ''}
              </span>
            </button>
            {!isCollapsed && (
              <ul className="px-1.5 pb-1.5">
                {catItems.map(item => (
                  <ItemRow key={item.id} item={item}
                           onToggle={handleToggle} onStar={handleStar} onDelete={handleDelete}
                           productRef={state.productMap?.[normalizeName(item.name)]}
                           onPinSave={pinSave} onPinClear={pinClear}
                           onRename={renameItem} onBuyFrom={setItemBuyFrom} onDefaultQty={setItemDefaultQty}
                           selecting={selecting} selected={selected.has(item.id)} onSelect={toggleSelected}
                           inCart={inCartById[item.id]} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {/* Clear checked bar */}
      {checkedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            {checkedCount} item{checkedCount === 1 ? '' : 's'} checked
          </span>
          <button
            onClick={clearChecked}
            title="Remove checked items, restock staples, and log them as purchased"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Clear checked
          </button>
        </div>
      )}

      {/* Staples */}
      <section className="space-y-2 pt-2">
        <button
          onClick={() => setShowStaples(s => !s)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showStaples ? 'rotate-90' : ''}`} />
          <Star className="w-3 h-3" /> Staples ({state.staples.length})
        </button>
        {showStaples && (() => {
          const q = normalizeName(stapleQuery);
          const counts: Record<'all' | StapleStatus, number> = { all: state.staples.length, stocked: 0, low: 0, out: 0 };
          for (const s of state.staples) counts[s.status]++;
          const filtered = state.staples.filter(s =>
            (stapleFilter === 'all' || s.status === stapleFilter) &&
            (!q || normalizeName(s.name).includes(q)));
          const groups = DEFAULT_CATEGORIES
            .map(cat => ({ cat, staples: filtered.filter(s => s.category === cat).sort((a, b) => a.name.localeCompare(b.name)) }))
            .filter(g => g.staples.length > 0);
          // While searching/filtering, collapse state is ignored — show all hits
          const filtersActive = q !== '' || stapleFilter !== 'all';
          const filterChip = (f: 'all' | StapleStatus, label: string) => (
            <button key={f}
              onClick={() => setStapleFilter(f)}
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                stapleFilter === f
                  ? (f === 'all' || f === 'stocked' ? 'bg-primary/10 text-primary border-primary/30' : STAPLE_STATUS_STYLE[f])
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}>
              {label} ({counts[f]})
            </button>
          );
          return (
          <div className="rounded-xl border border-border bg-card p-3 space-y-2">
            <p className="text-[11px] text-muted-foreground/70 px-1">
              Tap the status to cycle Stocked → Low → Out. Low or Out adds the item back to your list automatically.
            </p>

            {/* Search + status filters */}
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="flex items-center gap-1.5 flex-1 min-w-[10rem] rounded-md border border-border px-2 py-1 focus-within:border-foreground/30 transition-colors">
                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  value={stapleQuery}
                  onChange={e => setStapleQuery(e.target.value)}
                  placeholder="Search staples…"
                  className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                {stapleQuery && (
                  <button onClick={() => setStapleQuery('')} aria-label="Clear search"
                          className="text-muted-foreground/50 hover:text-foreground transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                {filterChip('all', 'All')}
                {filterChip('stocked', STAPLE_STATUS_LABELS.stocked)}
                {filterChip('low', STAPLE_STATUS_LABELS.low)}
                {filterChip('out', STAPLE_STATUS_LABELS.out)}
              </span>
            </div>

            {state.staples.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-2">
                No staples yet — star an item on your list to make it a staple.
              </p>
            )}
            {state.staples.length > 0 && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-2">
                Nothing matches{q ? ` “${stapleQuery.trim()}”` : ''}{stapleFilter !== 'all' ? ` with status ${STAPLE_STATUS_LABELS[stapleFilter]}` : ''}.
              </p>
            )}

            {/* Category groups */}
            {groups.map(({ cat, staples: groupStaples }) => {
              const isCollapsed = !filtersActive && !!stapleCollapsed[cat];
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleStapleCollapsed(cat)}
                    className="w-full flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                    <ChevronRight className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                    {cat}
                    <span className="text-muted-foreground/50 font-normal">({groupStaples.length})</span>
                  </button>
                  {!isCollapsed && (
                    <ul>
                      {groupStaples.map(staple => (
                        <li key={staple.id} className="group flex items-center gap-2 pl-5 pr-2 py-1.5 rounded-lg hover:bg-accent/30 transition-colors">
                          <span className="flex-1 min-w-0 text-sm text-foreground truncate">{staple.name}</span>
                          {staple.lastPurchased && (
                            <span className="text-[11px] text-muted-foreground/60 hidden sm:inline">
                              bought {staple.lastPurchased}
                            </span>
                          )}
                          <select
                            value={staple.category}
                            onChange={e => setStapleCategory(staple, e.target.value)}
                            title="Move to another category"
                            aria-label={`Category for ${staple.name}`}
                            className="text-[11px] bg-card border border-border rounded-md px-1 py-0.5 text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground focus:text-foreground focus:outline-none transition-colors max-w-[7.5rem]">
                            {DEFAULT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <ItemSettings
                            name={staple.name} pin={state.productMap?.[normalizeName(staple.name)]}
                            onSavePin={pinSave} onClearPin={pinClear}
                            buyFrom={staple.buyFrom} onBuyFrom={r => patchStaple(staple.id, { buyFrom: r })}
                            defaultQty={staple.defaultQty} onDefaultQty={n => patchStaple(staple.id, { defaultQty: n })}
                            restockAt={staple.restockAt ?? 'low'} onRestockAt={r => patchStaple(staple.id, { restockAt: r })}
                            onRename={n => patchStaple(staple.id, { name: n })} />
                          <button
                            onClick={() => cycleStaple(staple)}
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${STAPLE_STATUS_STYLE[staple.status]}`}>
                            {STAPLE_STATUS_LABELS[staple.status]}
                          </button>
                          <button
                            onClick={() => deleteStaple(staple)}
                            title="Remove staple"
                            aria-label={`Remove staple ${staple.name}`}
                            className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-destructive transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            <div className="flex items-center gap-2 px-2 pt-1.5 border-t border-border">
              <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                value={stapleInput}
                onChange={e => setStapleInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addStaple(); }}
                placeholder="Add a staple…"
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none py-1.5"
              />
            </div>
          </div>
          );
        })()}
      </section>
    </div>
  );
}
