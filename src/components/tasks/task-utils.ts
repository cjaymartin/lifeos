import type { Task, TaskDue } from '@/features/tasks/ops/types';

// ─── Dates ───────────────────────────────────────────────────────────────────

/** Local YYYY-MM-DD */
export function localISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const datePart = (date: string) => date.slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localISO(d);
}

export const isOverdue = (due: TaskDue | null, today = localISO()) =>
  !!due && datePart(due.date) < today;

export const isDueToday = (due: TaskDue | null, today = localISO()) =>
  !!due && datePart(due.date) === today;

export function formatTime(due: TaskDue): string | null {
  if (!due.hasTime) return null;
  const d = new Date(due.date);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Tomorrow", "Yesterday", "Mon", "Jun 20", "Jun 20, 2027" */
export function formatDueLabel(due: TaskDue, today = localISO()): string {
  const date = datePart(due.date);
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${date}T12:00:00`);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  if (date > today && date <= addDays(today, 6))
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString(
    'en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

export function formatDayHeading(date: string, today = localISO()): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** Due date asc (no-date last), then priority (1 = highest first), then manual order */
export function byAgenda(a: Task, b: Task): number {
  const ad = a.due?.date ?? '9999';
  const bd = b.due?.date ?? '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.order - b.order;
}

// ─── Colors ──────────────────────────────────────────────────────────────────

/** Priority accents — 1 is highest (Todoist P1 red) */
export const PRIORITY_COLORS: Record<number, { ring: string; text: string }> = {
  1: { ring: 'border-red-500', text: 'text-red-500' },
  2: { ring: 'border-orange-400', text: 'text-orange-400' },
  3: { ring: 'border-blue-400', text: 'text-blue-400' },
  4: { ring: 'border-muted-foreground/40', text: 'text-muted-foreground' },
};

/** Todoist named colors → hex (for project/label dots) */
const PROVIDER_COLORS: Record<string, string> = {
  berry_red: '#b8255f', red: '#db4035', orange: '#ff9933', yellow: '#fad000',
  olive_green: '#afb83b', lime_green: '#7ecc49', green: '#299438', mint_green: '#6accbc',
  teal: '#158fad', sky_blue: '#14aaf5', light_blue: '#96c3eb', blue: '#4073ff',
  grape: '#884dff', violet: '#af38eb', lavender: '#eb96eb', magenta: '#e05194',
  salmon: '#ff8d85', charcoal: '#808080', grey: '#b8b8b8', taupe: '#ccac93',
};

export const providerColor = (name: string) => PROVIDER_COLORS[name] ?? '#808080';
