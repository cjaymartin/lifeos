// ── Dashboard widget selection ───────────────────────────────────────────────
//
// Pure logic for which registry widgets are visible today, split by layout.
// Rendering is a type→adapter mapping on the dashboard; this module owns the
// registry shape and the display-condition vocabulary.

export interface WidgetDef {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  order: number;
  size: 'card' | 'full';
  displayCondition?: string;
  config: Record<string, unknown>;
  dataKey: string;
  populator?: string;
}

export interface DailyData {
  date: string;
  greeting: string;
  briefing: string;
  weather?: {
    code: number; current: number; feelsLike: number; condition: string;
    high: number; low: number; wind: number; precipitation: string;
  };
  tasks?: { dueToday: number; overdue: number; items: string[] };
  calendar?: { title: string; time: string; soon: boolean }[];
  trash?: { today: boolean; recycling: boolean; note: string | null };
  /** Upcoming birthdays (next ~30 days), each as { name, date: YYYY-MM-DD }. */
  birthdays?: { name: string; date: string }[];
  /** Next recurring water delivery, from the email scan (populate-daily step-5.7). */
  water?: { nextDate: string; vendor: string; product?: string; note?: string | null };
  items?: string[];
  [key: string]: unknown;
}

export interface WidgetContext {
  daily: DailyData | null;
  deliveriesCount: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  /** Reference "now" for date-window conditions. Defaults to the real clock. */
  now?: Date;
}

// Water delivery surfaces two weeks out and escalates to a warning at five days.
export const WATER_WINDOW_DAYS = 14;
export const WATER_WARNING_DAYS = 5;

/** Whole calendar days from `from` (default: now) until the given YYYY-MM-DD. */
export function daysUntil(iso: string, from: Date = new Date()): number {
  const target = new Date(`${iso}T12:00:00`);
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

function shouldShow(w: WidgetDef, ctx: WidgetContext): boolean {
  switch (w.displayCondition) {
    case 'mon-to-trash-day':
      return ctx.dayOfWeek >= 1 && ctx.dayOfWeek <= 3;
    case 'has-events': {
      const d = ctx.daily?.[w.dataKey];
      return Array.isArray(d) && d.length > 0;
    }
    case 'has-data':
      return !!ctx.daily?.[w.dataKey];
    case 'has-deliveries':
      return ctx.deliveriesCount > 0;
    case 'water-window': {
      const next = ctx.daily?.water?.nextDate;
      if (!next) return false;
      const d = daysUntil(next, ctx.now ?? new Date());
      return d >= 0 && d <= WATER_WINDOW_DAYS;
    }
    default:
      return true;
  }
}

/** Enabled + condition-passing widgets, ordered, split by layout size. */
export function selectWidgets(
  widgets: WidgetDef[],
  ctx: WidgetContext,
): { cards: WidgetDef[]; fulls: WidgetDef[] } {
  const visible = [...widgets]
    .filter((w) => w.enabled)
    .sort((a, b) => a.order - b.order)
    .filter((w) => shouldShow(w, ctx));
  return {
    cards: visible.filter((w) => w.size === 'card'),
    fulls: visible.filter((w) => w.size === 'full'),
  };
}
