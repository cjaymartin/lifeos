// TEST-ONLY in-memory task provider (NIM-7).
//
// Selected by getProvider() *only* when LIFEOS_FAKE_TASKS=1 — a flag production
// never sets. It makes no network calls and only ever mutates the in-process
// mirror, so even if the flag leaked into a real deployment the worst case is a
// local-only sandbox backend, never a reachable third party.
//
// Purpose: now that runtime secrets are read from process.env only (so the
// sandboxed test server can no longer reach the real Todoist account), this
// gives the e2e/QA suites a connected-but-fake backend to exercise real
// add / complete / reopen / edit / delete round-trips against.

import { randomUUID } from 'crypto';
import type {
  DueSpec,
  SyncResult,
  TaskDraft,
  TaskMove,
  TaskPatch,
  TaskProvider,
} from './provider';
import type { CompletedTask, Label, Project, Section, Task, TaskDue } from './types';
import { getSnapshot } from './store';

const g = globalThis as any;
const state: {
  seeded: boolean;
  tasks: Task[];
  completed: CompletedTask[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  token: number;
} = (g.__lifeosFakeTasks ??= {
  seeded: false,
  tasks: [],
  completed: [],
  projects: [],
  sections: [],
  labels: [],
  token: 0,
});

/** Seed the fake backend from the mirror once, so reads stay identical until a test mutates. */
async function ensureSeeded(): Promise<void> {
  if (state.seeded) return;
  const snap = await getSnapshot();
  state.tasks = snap.tasks.map((t) => ({ ...t }));
  state.projects = snap.projects.map((p) => ({ ...p }));
  state.sections = snap.sections.map((s) => ({ ...s }));
  state.labels = snap.labels.map((l) => ({ ...l }));
  state.seeded = true;
}

function toDue(due: DueSpec | undefined, prev: TaskDue | null = null): TaskDue | null {
  if (due === undefined) return prev;
  if (due === null) return null;
  const date = due.date ?? prev?.date ?? '';
  return {
    date,
    hasTime: date.includes('T'),
    timezone: prev?.timezone ?? null,
    recurring: prev?.recurring ?? false,
    string: due.string ?? prev?.string ?? '',
  };
}

export class FakeTaskProvider implements TaskProvider {
  // Masquerade as the real provider id so the mirror, stats, and UI all behave
  // exactly as they would against Todoist — only the backend is swapped.
  readonly id = 'todoist';

  async sync(): Promise<SyncResult> {
    await ensureSeeded();
    // The fake holds the whole truth in memory, so every sync is a full snapshot.
    return {
      fullSync: true,
      syncToken: `fake-${++state.token}`,
      tasks: state.tasks.map((t) => ({ ...t })),
      removedTaskIds: [],
      deletedTaskIds: [],
      completed: state.completed.map((c) => ({ ...c })),
      projects: state.projects.map((p) => ({ ...p })),
      removedProjectIds: [],
      sections: state.sections.map((s) => ({ ...s })),
      removedSectionIds: [],
      labels: state.labels.map((l) => ({ ...l })),
      removedLabelIds: [],
    };
  }

  async createTask(draft: TaskDraft): Promise<string> {
    await ensureSeeded();
    const id = `fake-${randomUUID()}`;
    state.tasks.push({
      id,
      content: draft.content,
      description: draft.description ?? '',
      projectId: draft.projectId ?? null,
      sectionId: draft.sectionId ?? null,
      parentId: draft.parentId ?? null,
      order: state.tasks.length + 1,
      priority: draft.priority ?? 4,
      labels: draft.labels ?? [],
      due: toDue(draft.due),
      deadline: draft.deadline ?? null,
      duration: draft.duration ?? null,
      addedAt: new Date().toISOString(),
    });
    return id;
  }

  async quickAdd(text: string): Promise<void> {
    // Minimal: the whole text becomes the content. The real provider parses
    // #project / p1 / natural-language dates; tests needing those use createTask.
    await this.createTask({ content: text });
  }

  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    await ensureSeeded();
    const t = state.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`fake provider: no task ${id}`);
    if (patch.content !== undefined) t.content = patch.content;
    if (patch.description !== undefined) t.description = patch.description;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.labels !== undefined) t.labels = patch.labels;
    if (patch.deadline !== undefined) t.deadline = patch.deadline;
    if (patch.duration !== undefined) t.duration = patch.duration;
    if (patch.due !== undefined) t.due = toDue(patch.due, t.due);
  }

  async completeTask(id: string): Promise<void> {
    await ensureSeeded();
    const i = state.tasks.findIndex((x) => x.id === id);
    if (i === -1) throw new Error(`fake provider: no task ${id}`);
    const [t] = state.tasks.splice(i, 1);
    state.completed.unshift({
      id: t.id,
      content: t.content,
      projectId: t.projectId,
      labels: t.labels,
      priority: t.priority,
      completedAt: new Date().toISOString(),
    });
  }

  async uncompleteTask(id: string): Promise<void> {
    await ensureSeeded();
    const i = state.completed.findIndex((c) => c.id === id);
    if (i === -1) throw new Error(`fake provider: no completed task ${id}`);
    const [c] = state.completed.splice(i, 1);
    state.tasks.push({
      id: c.id,
      content: c.content,
      description: '',
      projectId: c.projectId,
      sectionId: null,
      parentId: null,
      order: state.tasks.length + 1,
      priority: c.priority,
      labels: c.labels,
      due: null,
      deadline: null,
      duration: null,
      addedAt: new Date().toISOString(),
    });
  }

  async deleteTask(id: string): Promise<void> {
    await ensureSeeded();
    state.tasks = state.tasks.filter((x) => x.id !== id);
    state.completed = state.completed.filter((c) => c.id !== id);
  }

  async moveTask(id: string, dest: TaskMove): Promise<void> {
    await ensureSeeded();
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    if (dest.parentId) t.parentId = dest.parentId;
    else if (dest.sectionId) t.sectionId = dest.sectionId;
    else if (dest.projectId) {
      t.projectId = dest.projectId;
      t.sectionId = null;
    }
  }

  async fetchCompleted(): Promise<CompletedTask[]> {
    await ensureSeeded();
    return state.completed.map((c) => ({ ...c }));
  }
}

/** True when the test-only fake provider is enabled. Read process.env at call time. */
export function fakeTasksEnabled(): boolean {
  return process.env.LIFEOS_FAKE_TASKS === '1';
}

/** The process-wide fake provider singleton (state lives on globalThis, HMR-safe). */
export function getFakeProvider(): FakeTaskProvider {
  return (g.__lifeosFakeProvider ??= new FakeTaskProvider());
}
