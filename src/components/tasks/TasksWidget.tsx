import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Task } from '@/lib/tasks/types';
import {
  byAgenda,
  formatDueLabel,
  formatTime,
  isDueToday,
  isOverdue,
  localISO,
  PRIORITY_COLORS,
} from './task-utils';
import { useTasks, type TasksData } from './useTasks';

/**
 * Dashboard Tasks card — live mirror of the provider, updated in near-real-time
 * via SSE. Replaces the old once-a-day snapshot from today.json.
 */
export default function TasksWidget({ initial, maxItems = 5 }: { initial?: TasksData; maxItems?: number }) {
  const { data, completeTask } = useTasks(initial);
  const today = localISO();
  const tasks = data?.tasks ?? [];

  const { overdue, dueToday, items } = useMemo(() => {
    const overdue = tasks.filter((t) => isOverdue(t.due, today)).sort(byAgenda);
    const dueToday = tasks.filter((t) => isDueToday(t.due, today)).sort(byAgenda);
    // Dashboard shows only what needs attention now — overdue + today, no upcoming filler
    const items: Task[] = [...overdue, ...dueToday];
    return { overdue, dueToday, items };
  }, [tasks, today]);

  const shown = items.slice(0, maxItems);

  return (
    <div className="relative rounded-xl border border-border bg-card p-5 space-y-3">
      <a
        href="/tasks"
        className="absolute top-3 right-3 p-1 rounded text-muted-foreground/25 hover:text-primary hover:bg-primary/10 transition-colors"
        aria-label="Open Tasks"
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
      </a>

      <div className="flex items-center justify-between">
        <a href="/tasks" className="text-sm font-medium text-foreground hover:text-primary transition-colors">
          Tasks
        </a>
        <div className="flex gap-2 mr-6">
          {dueToday.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              {dueToday.length} today
            </span>
          )}
          {overdue.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">
              {overdue.length} overdue
            </span>
          )}
          {dueToday.length === 0 && overdue.length === 0 && data?.sync?.configured && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium">
              All clear
            </span>
          )}
        </div>
      </div>

      {data && !data.sync.configured ? (
        <p className="text-xs text-muted-foreground">
          Not connected — add <code className="font-mono bg-muted px-1 rounded">TODOIST_API_TOKEN</code>{' '}
          to .env. <a href="/tasks" className="text-primary hover:underline">Details</a>
        </p>
      ) : shown.length > 0 ? (
        <ul className="space-y-1.5">
          {shown.map((t) => {
            const od = isOverdue(t.due, today);
            const td = isDueToday(t.due, today);
            return (
              <li key={t.id} className="group flex items-start gap-2 text-xs">
                <button
                  onClick={() => completeTask(t.id)}
                  aria-label="Complete task"
                  className={`mt-px h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] ${PRIORITY_COLORS[t.priority].ring}
                              hover:bg-accent/60 transition-colors flex items-center justify-center`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                       className={`w-2 h-2 opacity-0 group-hover:opacity-70 ${PRIORITY_COLORS[t.priority].text}`}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{t.content}</span>
                {t.due && (
                  <span className={`shrink-0 tabular-nums ${
                    od ? 'text-destructive' : td ? 'text-emerald-500' : 'text-muted-foreground/60'
                  }`}>
                    {td && formatTime(t.due) ? formatTime(t.due) : formatDueLabel(t.due, today)}
                  </span>
                )}
              </li>
            );
          })}
          {items.length > maxItems && (
            <li className="text-xs text-muted-foreground/60 pl-[22px]">
              <a href="/tasks" className="hover:text-primary">+{items.length - maxItems} more</a>
            </li>
          )}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing due today.</p>
      )}
    </div>
  );
}
