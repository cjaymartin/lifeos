import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  Hash,
  Inbox,
  RefreshCw,
  Sun,
  Tag,
} from 'lucide-react';
import type { CompletedTask, Project, Task } from '@/lib/tasks/types';
import QuickAdd from './QuickAdd';
import TaskItem from './TaskItem';
import {
  addDays,
  byAgenda,
  datePart,
  formatDayHeading,
  isDueToday,
  isOverdue,
  localISO,
  providerColor,
} from './task-utils';
import { useCompleted, useTasks, type TasksData } from './useTasks';

type View =
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'completed' }
  | { kind: 'stats' }
  | { kind: 'project'; id: string }
  | { kind: 'label'; name: string };

export default function TasksApp({ initial }: { initial?: TasksData }) {
  const { data, error, completeTask, reopenTask, deleteTask, updateTask, addTask, forceSync } =
    useTasks(initial);
  const [view, setView] = useState<View>({ kind: 'today' });
  const [syncing, setSyncing] = useState(false);

  const today = localISO();
  const tasks = data?.tasks ?? [];
  const projects = useMemo(
    () => [...(data?.projects ?? [])].sort((a, b) => Number(b.inbox) - Number(a.inbox) || a.order - b.order),
    [data?.projects],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const completed = useCompleted(
    view.kind === 'completed' || view.kind === 'stats' ? data?.version : undefined,
  );

  const counts = useMemo(() => {
    const overdue = tasks.filter((t) => isOverdue(t.due, today)).length;
    const dueToday = tasks.filter((t) => isDueToday(t.due, today)).length;
    const perProject = new Map<string, number>();
    for (const t of tasks) {
      if (t.projectId) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1);
    }
    return { overdue, dueToday, perProject };
  }, [tasks, today]);

  const labels = useMemo(() => {
    const used = new Set(tasks.flatMap((t) => t.labels));
    const named = (data?.labels ?? []).filter((l) => used.has(l.name));
    const extra = [...used].filter((n) => !named.some((l) => l.name === n));
    return [...named.map((l) => ({ name: l.name, color: l.color })), ...extra.map((n) => ({ name: n, color: 'grey' }))];
  }, [tasks, data?.labels]);

  const doSync = async () => {
    setSyncing(true);
    await forceSync();
    setSyncing(false);
  };

  const itemProps = {
    onComplete: completeTask,
    onUpdate: updateTask,
    onDelete: deleteTask,
  };

  const renderList = (list: Task[], showProject = true) => (
    <ul>
      {list.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          project={showProject ? projectById.get(t.projectId ?? '') ?? null : null}
          {...itemProps}
        />
      ))}
    </ul>
  );

  // ── Views ──────────────────────────────────────────────────────────────────

  const renderToday = () => {
    const overdue = tasks.filter((t) => isOverdue(t.due, today)).sort(byAgenda);
    const dueToday = tasks.filter((t) => isDueToday(t.due, today)).sort(byAgenda);
    return (
      <div className="space-y-6">
        {overdue.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-1">
              Overdue — {overdue.length}
            </h2>
            {renderList(overdue)}
          </section>
        )}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Today — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </h2>
          {dueToday.length > 0 ? (
            renderList(dueToday)
          ) : (
            <p className="text-sm text-muted-foreground py-3">
              {overdue.length === 0 ? 'All clear — nothing due today. 🎉' : 'Nothing else due today.'}
            </p>
          )}
        </section>
      </div>
    );
  };

  const renderUpcoming = () => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
    const overdueOrToday = tasks
      .filter((t) => t.due && datePart(t.due.date) <= today)
      .sort(byAgenda);
    return (
      <div className="space-y-6">
        {overdueOrToday.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Today & overdue — {overdueOrToday.length}
            </h2>
            {renderList(overdueOrToday)}
          </section>
        )}
        {days.map((d) => {
          const list = tasks.filter((t) => t.due && datePart(t.due.date) === d).sort(byAgenda);
          return (
            <section key={d}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {formatDayHeading(d, today)}
              </h2>
              {list.length > 0 ? renderList(list) : (
                <p className="text-xs text-muted-foreground/50 py-1.5">Nothing scheduled</p>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  const renderProject = (project: Project) => {
    const inProject = tasks.filter((t) => t.projectId === project.id);
    const sections = (data?.sections ?? [])
      .filter((s) => s.projectId === project.id)
      .sort((a, b) => a.order - b.order);
    const childrenOf = new Map<string, Task[]>();
    for (const t of inProject) {
      if (t.parentId) {
        childrenOf.set(t.parentId, [...(childrenOf.get(t.parentId) ?? []), t]);
      }
    }
    const ids = new Set(inProject.map((t) => t.id));
    const topLevel = (list: Task[]) =>
      list.filter((t) => !t.parentId || !ids.has(t.parentId)).sort((a, b) => a.order - b.order);

    const renderTree = (list: Task[], depth: number): ReactNode =>
      list.map((t) => (
        <Fragment key={t.id}>
          <TaskItem task={t} depth={depth} {...itemProps} />
          {renderTree((childrenOf.get(t.id) ?? []).sort((a, b) => a.order - b.order), depth + 1)}
        </Fragment>
      ));

    const noSection = topLevel(inProject.filter((t) => !t.sectionId));
    return (
      <div className="space-y-6">
        {noSection.length > 0 && <ul>{renderTree(noSection, 0)}</ul>}
        {sections.map((s) => {
          const list = topLevel(inProject.filter((t) => t.sectionId === s.id));
          if (list.length === 0) return null;
          return (
            <section key={s.id}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {s.name} — {list.length}
              </h2>
              <ul>{renderTree(list, 0)}</ul>
            </section>
          );
        })}
        {inProject.length === 0 && (
          <p className="text-sm text-muted-foreground py-3">No tasks in this project.</p>
        )}
      </div>
    );
  };

  const renderLabel = (name: string) => {
    const list = tasks.filter((t) => t.labels.includes(name)).sort(byAgenda);
    return list.length > 0 ? renderList(list) : (
      <p className="text-sm text-muted-foreground py-3">No tasks with this label.</p>
    );
  };

  const renderCompleted = (items: CompletedTask[]) => {
    const byDay = new Map<string, CompletedTask[]>();
    for (const c of items) {
      const d = datePart(c.completedAt);
      byDay.set(d, [...(byDay.get(d) ?? []), c]);
    }
    if (items.length === 0)
      return <p className="text-sm text-muted-foreground py-3">No completed tasks yet — the log fills in as you finish things.</p>;
    return (
      <div className="space-y-5">
        {[...byDay.entries()].map(([day, list]) => (
          <section key={day}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {formatDayHeading(day, today)} — {list.length}
            </h2>
            <ul>
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-2.5 py-2 border-b border-border/60">
                  <CircleCheck className="w-[18px] h-[18px] text-emerald-500 shrink-0" />
                  <span className="flex-1 text-sm text-muted-foreground line-through decoration-muted-foreground/40 truncate">
                    {c.content}
                  </span>
                  {c.projectId && projectById.get(c.projectId) && (
                    <span className="text-xs text-muted-foreground/60 shrink-0">
                      {projectById.get(c.projectId)!.name}
                    </span>
                  )}
                  <button
                    onClick={() => reopenTask(c.id)}
                    className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 shrink-0"
                  >
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  };

  const renderStats = (items: CompletedTask[]) => {
    const dayCount = (d: string) => items.filter((c) => datePart(c.completedAt) === d).length;
    const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    const bars = last14.map((d) => ({ day: d, count: dayCount(d) }));
    const max = Math.max(1, ...bars.map((b) => b.count));
    const within = (days: number) =>
      items.filter((c) => datePart(c.completedAt) > addDays(today, -days)).length;

    const cards = [
      { label: 'Completed today', value: dayCount(today) },
      { label: 'Last 7 days', value: within(7) },
      { label: 'Last 30 days', value: within(30) },
      { label: 'Avg / day (30d)', value: (within(30) / 30).toFixed(1) },
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{c.label}</p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Completions — last 14 days
          </p>
          <div className="flex items-end gap-1.5 h-28">
            {bars.map((b) => (
              <div key={b.day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">{b.count || ''}</span>
                <div
                  className={`w-full rounded-sm ${b.count ? 'bg-primary/70' : 'bg-muted'}`}
                  style={{ height: `${Math.max(4, (b.count / max) * 80)}px` }}
                  title={`${b.day}: ${b.count}`}
                />
                <span className="text-[10px] text-muted-foreground/60">
                  {new Date(`${b.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'narrow' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Nav ────────────────────────────────────────────────────────────────────

  const navBtn = (active: boolean) =>
    `w-full flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg transition-colors text-left ${
      active ? 'bg-accent/60 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/30'
    }`;

  const viewTitle =
    view.kind === 'today' ? 'Today'
    : view.kind === 'upcoming' ? 'Upcoming'
    : view.kind === 'completed' ? 'Completed'
    : view.kind === 'stats' ? 'Stats'
    : view.kind === 'project' ? projectById.get(view.id)?.name ?? 'Project'
    : `@${view.name}`;

  const showQuickAdd = view.kind === 'today' || view.kind === 'upcoming' || view.kind === 'project';

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold text-foreground">Tasks</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                !data?.sync?.configured ? 'bg-zinc-500'
                : data?.sync?.lastError ? 'bg-destructive'
                : 'bg-emerald-500'
              }`}
            />
            {!data?.sync?.configured
              ? 'Not connected'
              : data?.sync?.lastError
                ? 'Sync error'
                : data?.lastSyncAt
                  ? `Synced ${new Date(data.lastSyncAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                  : 'Waiting for first sync…'}
          </p>
        </div>
        <button
          onClick={() => void doSync()}
          disabled={syncing || !data?.sync?.configured}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          Sync
        </button>
      </div>

      {/* not configured / error notices */}
      {data && !data.sync.configured && (
        <div className="rounded-xl border border-warning-border bg-warning-subtle p-4 space-y-1">
          <p className="text-sm font-medium text-warning">Todoist isn't connected yet</p>
          <p className="text-xs text-muted-foreground">
            Add <code className="font-mono bg-muted px-1 rounded">TODOIST_API_TOKEN</code> to{' '}
            <code className="font-mono bg-muted px-1 rounded">.env</code> (Todoist → Settings →
            Integrations → Developer → API token) and restart LifeOS. Sync starts automatically.
          </p>
        </div>
      )}
      {error && data?.sync?.configured && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 flex items-center gap-2">
          <CircleAlert className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-xs text-destructive truncate">{error}</p>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6 md:gap-8">
        {/* sidebar nav */}
        <nav className="md:w-52 shrink-0 space-y-4">
          <div className="space-y-0.5">
            <button className={navBtn(view.kind === 'today')} onClick={() => setView({ kind: 'today' })}>
              <Sun className="w-4 h-4" /> Today
              {(counts.dueToday > 0 || counts.overdue > 0) && (
                <span className={`ml-auto text-xs tabular-nums ${counts.overdue ? 'text-destructive' : ''}`}>
                  {counts.overdue + counts.dueToday}
                </span>
              )}
            </button>
            <button className={navBtn(view.kind === 'upcoming')} onClick={() => setView({ kind: 'upcoming' })}>
              <CalendarDays className="w-4 h-4" /> Upcoming
            </button>
            <button className={navBtn(view.kind === 'completed')} onClick={() => setView({ kind: 'completed' })}>
              <CircleCheck className="w-4 h-4" /> Completed
            </button>
            <button className={navBtn(view.kind === 'stats')} onClick={() => setView({ kind: 'stats' })}>
              <ChartColumn className="w-4 h-4" /> Stats
            </button>
          </div>

          {projects.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2.5 pb-1">
                Projects
              </p>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={navBtn(view.kind === 'project' && view.id === p.id)}
                  style={p.parentId ? { paddingLeft: 22 } : undefined}
                  onClick={() => setView({ kind: 'project', id: p.id })}
                >
                  {p.inbox ? (
                    <Inbox className="w-4 h-4 shrink-0" />
                  ) : (
                    <Hash className="w-4 h-4 shrink-0" style={{ color: providerColor(p.color) }} />
                  )}
                  <span className="truncate">{p.name}</span>
                  {(counts.perProject.get(p.id) ?? 0) > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {counts.perProject.get(p.id)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {labels.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2.5 pb-1">
                Labels
              </p>
              {labels.map((l) => (
                <button
                  key={l.name}
                  className={navBtn(view.kind === 'label' && view.name === l.name)}
                  onClick={() => setView({ kind: 'label', name: l.name })}
                >
                  <Tag className="w-4 h-4 shrink-0" style={{ color: providerColor(l.color) }} />
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* content */}
        <main className="flex-1 min-w-0 space-y-4">
          <h2 className="text-lg font-medium text-foreground md:sr-only">{viewTitle}</h2>
          {showQuickAdd && data?.sync?.configured && (
            <QuickAdd
              projectId={view.kind === 'project' ? view.id : undefined}
              onAdd={addTask}
            />
          )}
          {view.kind === 'today' && renderToday()}
          {view.kind === 'upcoming' && renderUpcoming()}
          {view.kind === 'project' &&
            (projectById.get(view.id) ? renderProject(projectById.get(view.id)!) : null)}
          {view.kind === 'label' && renderLabel(view.name)}
          {view.kind === 'completed' && renderCompleted(completed)}
          {view.kind === 'stats' && renderStats(completed)}
        </main>
      </div>
    </div>
  );
}
