// ── Client job-watch ─────────────────────────────────────────────────────────
//
// The one place the client knows how to watch a server-side agent job:
// trigger it, poll its status seam, and decide done/error from the payload.
// Components name a job and render a state — cadence, startup windows, and
// the "process exited but nothing changed" rule all live here.
//
// Framework-free on purpose: fully unit-testable with fake timers, and the
// React components stay thin.

export type JobState = 'idle' | 'loading' | 'done' | 'error';
export type JobResult = 'done' | 'error';

/** The shared button palette for job states (was copy-pasted per component). */
export const JOB_STATE_COLORS: Record<JobState, string> = {
  idle: 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/30',
  loading: 'border-border text-muted-foreground cursor-wait',
  done: 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10',
  error: 'border-destructive/30 text-destructive bg-destructive/10',
};

export interface PollSpec<S> {
  statusUrl: string;
  /** First poll delay — agent startup + first tool call (default 8s). */
  firstDelayMs?: number;
  /** Poll cadence (default 4s). */
  intervalMs?: number;
  /** Give up with 'error' after this many polls (default 60 ≈ 4 min at 4s). */
  maxAttempts?: number;
  /** Called with every status payload (progress feeds). */
  onStatus?: (status: S) => void;
  /** Decide from a payload; 'pending' keeps polling. */
  verdict: (status: S, ctx: { attempts: number }) => JobResult | 'pending';
  /** What a failed status fetch means: settle 'error' (default) or keep polling. */
  fetchError?: 'error' | 'continue';
}

export interface JobHandle {
  result: Promise<JobResult>;
  cancel: () => void;
}

/** Poll a status seam until its verdict settles. */
export function pollJob<S>(spec: PollSpec<S>): JobHandle {
  const {
    statusUrl,
    firstDelayMs = 8000,
    intervalMs = 4000,
    maxAttempts = 60,
    onStatus,
    verdict,
    fetchError = 'error',
  } = spec;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let attempts = 0;

  const result = new Promise<JobResult>((resolve) => {
    const poll = async () => {
      if (cancelled) return;
      if (++attempts > maxAttempts) return resolve('error');
      try {
        const res = await fetch(statusUrl);
        const status = (await res.json()) as S;
        if (cancelled) return;
        onStatus?.(status);
        const v = verdict(status, { attempts });
        if (v !== 'pending') return resolve(v);
      } catch {
        if (cancelled) return;
        if (fetchError === 'error') return resolve('error');
      }
      timer = setTimeout(poll, intervalMs);
    };
    timer = setTimeout(poll, firstDelayMs);
  });

  return {
    result,
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/* ── Protocols ──────────────────────────────────────────────────────────── */

interface RefreshStatus {
  running: boolean;
  lastUpdated: number | null;
}

/**
 * The mtime protocol: snapshot the data file's mtime, POST the trigger, then
 * poll until the file changes (done) or the agent exits without changing it
 * (error). Used by every "Refresh" button backed by a populate-* agent.
 */
export async function watchRefreshJob(opts: {
  statusUrl: string;
  triggerUrl: string;
  firstDelayMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
  /** Polls that must pass before "not running" counts as failure (default 2). */
  minAttempts?: number;
}): Promise<JobResult> {
  const { statusUrl, triggerUrl, minAttempts = 2, ...poll } = opts;
  try {
    const before = await fetch(statusUrl);
    const { lastUpdated: initialMtime } = (await before.json()) as RefreshStatus;

    const res = await fetch(triggerUrl, { method: 'POST' });
    if (!res.ok) return 'error';

    return await pollJob<RefreshStatus>({
      statusUrl,
      ...poll,
      verdict: ({ running, lastUpdated }, { attempts }) => {
        if (lastUpdated !== initialMtime) return 'done'; // file rewritten — success
        if (!running && attempts > minAttempts) return 'error'; // exited, unchanged
        return 'pending';
      },
    }).result;
  } catch {
    return 'error';
  }
}

/**
 * The boolean-flag protocol: poll a status seam until `flag` clears. The
 * startup window (minAttempts) stops a not-yet-started job from reading as
 * already finished.
 */
export function watchFlagJob(opts: {
  statusUrl: string;
  flag: string;
  firstDelayMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
  minAttempts?: number;
}): Promise<JobResult> {
  const { statusUrl, flag, minAttempts = 2, ...poll } = opts;
  return pollJob<Record<string, boolean>>({
    statusUrl,
    ...poll,
    verdict: (status, { attempts }) =>
      !status[flag] && attempts > minAttempts ? 'done' : 'pending',
  }).result;
}
