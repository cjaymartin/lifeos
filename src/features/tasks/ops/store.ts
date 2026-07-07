import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { writeJson } from '@/lib/content-store';
import { contentPath, vaultPath } from '@/lib/content-paths';
import { readCollection, writeCollection } from '@/lib/markdown-store';
import type { SyncResult } from './provider';
import type { CompletedTask, Task, TasksSnapshot } from './types';
import { emptySnapshot } from './types';

// Tasks are a live Todoist mirror split across two content roots:
//   - The human-facing rows — active tasks and the completed-history log — live
//     as one Markdown note per task in the vault, so Obsidian can read them.
//   - The sync scaffolding (provider id, opaque syncToken, version counter,
//     lastSyncAt) plus the relational reference data tasks point at by id
//     (projects, sections, labels) stay as a machine JSON file — none of it is
//     human-authored content and the syncToken is opaque provider state.
const META_FILE = contentPath('tasks', 'meta.json');
const ACTIVE_DIR = vaultPath('tasks', 'active');
const COMPLETED_DIR = vaultPath('tasks', 'completed');
const COMPLETED_CAP = 2000;

/** The machine-store half of the snapshot: everything that isn't a task note. */
type TaskMeta = Omit<TasksSnapshot, 'tasks'>;

function emptyMeta(provider: string): TaskMeta {
  const { tasks, ...meta } = emptySnapshot(provider);
  return meta;
}

// HMR/module-duplication safe singleton state
const g = globalThis as any;
const state: {
  emitter: EventEmitter;
  snapshot: TasksSnapshot | null;
  completed: CompletedTask[] | null;
} = (g.__lifeosTaskStore ??= {
  emitter: new EventEmitter(),
  snapshot: null,
  completed: null,
});
state.emitter.setMaxListeners(50); // many SSE clients

/** Subscribe to 'change' events: (version: number) => void */
export const taskEvents: EventEmitter = state.emitter;

/** Deterministic active-task order (readdir is unordered): by `order`, then id. */
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Readable note body for an active task — so opening it in Obsidian shows prose
 *  (title, description, due) instead of only the frontmatter Properties table.
 *  Regenerated on every sync; readers key off frontmatter, so the body is display-only. */
function taskNoteBody(t: Task): string {
  const parts = [`# ${t.content}`];
  if (t.description?.trim()) parts.push('', t.description.trim());
  const due = t.due?.string || t.due?.date;
  if (due) parts.push('', `**Due:** ${due}`);
  return parts.join('\n');
}

/** Readable note body for a completed task. */
function completedNoteBody(c: CompletedTask): string {
  return [`# ${c.content}`, '', `Completed ${c.completedAt.slice(0, 10)}`].join('\n');
}

export async function getSnapshot(): Promise<TasksSnapshot> {
  if (state.snapshot) return state.snapshot;
  let meta: TaskMeta;
  try {
    meta = JSON.parse(await readFile(META_FILE, 'utf-8'));
  } catch {
    meta = emptyMeta('todoist');
  }
  const notes = await readCollection<Task>(ACTIVE_DIR);
  state.snapshot = { ...meta, tasks: sortTasks(notes.map((n) => n.data)) };
  return state.snapshot!;
}

export async function getCompleted(): Promise<CompletedTask[]> {
  if (state.completed) return state.completed;
  const notes = await readCollection<CompletedTask>(COMPLETED_DIR);
  state.completed = notes
    .map((n) => n.data)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return state.completed!;
}

/** Persist the non-task half of a snapshot to the machine store. */
async function writeMeta(snap: TasksSnapshot): Promise<void> {
  const { tasks, ...meta } = snap;
  await writeJson(META_FILE, meta);
}

function upsertById<T extends { id: string }>(list: T[], updates: T[], removedIds: string[]): T[] {
  const removed = new Set(removedIds);
  const byId = new Map(list.filter((x) => !removed.has(x.id)).map((x) => [x.id, x]));
  for (const u of updates) byId.set(u.id, u);
  return [...byId.values()];
}

/** Merge a provider sync delta into the mirror, persist, and notify listeners. */
export async function applySync(provider: string, result: SyncResult): Promise<TasksSnapshot> {
  const prev = await getSnapshot();
  const next: TasksSnapshot = result.fullSync
    ? {
        ...emptySnapshot(provider),
        tasks: result.tasks,
        projects: result.projects,
        sections: result.sections,
        labels: result.labels,
      }
    : {
        ...prev,
        tasks: upsertById(prev.tasks, result.tasks, result.removedTaskIds),
        projects: upsertById(prev.projects, result.projects, result.removedProjectIds),
        sections: upsertById(prev.sections, result.sections, result.removedSectionIds),
        labels: upsertById(prev.labels, result.labels, result.removedLabelIds),
      };

  next.provider = provider;
  next.syncToken = result.syncToken;
  next.lastSyncAt = new Date().toISOString();
  next.version = prev.version + 1;
  next.tasks = sortTasks(next.tasks);

  state.snapshot = next;
  await writeMeta(next);
  await writeCollection(ACTIVE_DIR, next.tasks, (t) => t.content, { id: (t) => t.id, body: taskNoteBody });

  // Completions observed in the delta feed the history log incrementally;
  // reactivated (uncompleted) and hard-deleted tasks must drop back out of it.
  if (result.completed.length) await mergeCompleted(result.completed, false);
  const dropFromLog = new Set([...result.tasks.map((t) => t.id), ...result.deletedTaskIds]);
  if (dropFromLog.size) {
    const completed = await getCompleted();
    if (completed.some((c) => dropFromLog.has(c.id))) {
      state.completed = completed.filter((c) => !dropFromLog.has(c.id));
      await writeCollection(COMPLETED_DIR, state.completed, (c) => c.content, { id: (c) => c.id, body: completedNoteBody });
    }
  }

  state.emitter.emit('change', next.version);
  return next;
}

/** Merge completed tasks into the history log (dedup by id, newest first, capped). */
export async function mergeCompleted(items: CompletedTask[], emit = true): Promise<void> {
  const existing = await getCompleted();
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (const item of items) byId.set(item.id, item);
  state.completed = [...byId.values()]
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, COMPLETED_CAP);
  await writeCollection(COMPLETED_DIR, state.completed, (c) => c.content, { id: (c) => c.id, body: completedNoteBody });
  if (emit) {
    const snap = await getSnapshot();
    state.emitter.emit('change', snap.version);
  }
}
