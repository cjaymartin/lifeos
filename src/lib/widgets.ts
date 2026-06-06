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
  items?: string[];
  [key: string]: unknown;
}

export interface WidgetContext {
  daily: DailyData | null;
  deliveriesCount: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
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
