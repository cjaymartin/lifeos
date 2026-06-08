import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { writeJson } from '@/lib/content-store';
import type { SyncResult } from './provider';
import type { CompletedTask, TasksSnapshot } from './types';
import { emptySnapshot } from './types';

const DIR = join(process.cwd(), 'src/content/tasks');
const SNAPSHOT_FILE = join(DIR, 'tasks.json');
const COMPLETED_FILE = join(DIR, 'completed.json');
const COMPLETED_CAP = 2000;

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

export async function getSnapshot(): Promise<TasksSnapshot> {
  if (state.snapshot) return state.snapshot;
  try {
    state.snapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf-8'));
  } catch {
    state.snapshot = emptySnapshot('todoist');
  }
  return state.snapshot!;
}

export async function getCompleted(): Promise<CompletedTask[]> {
  if (state.completed) return state.completed;
  try {
    state.completed = JSON.parse(await readFile(COMPLETED_FILE, 'utf-8'));
  } catch {
    state.completed = [];
  }
  return state.completed!;
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

  state.snapshot = next;
  await writeJson(SNAPSHOT_FILE, next);

  // Completions observed in the delta feed the history log incrementally;
  // reactivated (uncompleted) and hard-deleted tasks must drop back out of it.
  if (result.completed.length) await mergeCompleted(result.completed, false);
  const dropFromLog = new Set([...result.tasks.map((t) => t.id), ...result.deletedTaskIds]);
  if (dropFromLog.size) {
    const completed = await getCompleted();
    if (completed.some((c) => dropFromLog.has(c.id))) {
      state.completed = completed.filter((c) => !dropFromLog.has(c.id));
      await writeJson(COMPLETED_FILE, state.completed);
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
  await writeJson(COMPLETED_FILE, state.completed);
  if (emit) {
    const snap = await getSnapshot();
    state.emitter.emit('change', snap.version);
  }
}
