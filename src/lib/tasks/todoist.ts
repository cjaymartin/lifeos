import { randomUUID } from 'crypto';
import type {
  DueSpec,
  SyncResult,
  TaskDraft,
  TaskMove,
  TaskPatch,
  TaskProvider,
} from './provider';
import { ProviderError } from './provider';
import { getAccountSecrets } from '../settings/secrets';
import type { CompletedTask, Label, Project, Section, Task, TaskDue } from './types';

const API = 'https://api.todoist.com/api/v1';
const RESOURCE_TYPES = JSON.stringify(['items', 'projects', 'sections', 'labels']);

// ─── Raw Todoist shapes (the parts we read) ─────────────────────────────────

interface TodoistDue {
  date: string;
  timezone: string | null;
  string: string;
  is_recurring: boolean;
}

interface TodoistItem {
  id: string;
  content: string;
  description: string;
  project_id: string | null;
  section_id: string | null;
  parent_id: string | null;
  child_order: number;
  /** Todoist: 4 = highest, 1 = lowest. We invert to 1 = highest. */
  priority: number;
  labels: string[];
  due: TodoistDue | null;
  deadline: { date: string } | null;
  duration: { amount: number; unit: 'minute' | 'day' } | null;
  checked: boolean;
  is_deleted: boolean;
  added_at: string | null;
  completed_at: string | null;
}

interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  child_order: number;
  is_favorite: boolean;
  is_archived: boolean;
  is_deleted: boolean;
  inbox_project?: boolean;
}

interface TodoistSection {
  id: string;
  name: string;
  project_id: string;
  section_order: number;
  is_archived: boolean;
  is_deleted: boolean;
}

interface TodoistLabel {
  id: string;
  name: string;
  color: string;
  item_order: number;
  is_deleted: boolean;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** Todoist priority is inverted (4 = highest). Normalize so 1 = highest, like the UI's P1. */
const fromTodoistPriority = (p: number) => Math.min(4, Math.max(1, 5 - p)) as 1 | 2 | 3 | 4;
const toTodoistPriority = (p: number) => 5 - p;

function normalizeDue(due: TodoistDue | null): TaskDue | null {
  if (!due) return null;
  return {
    date: due.date,
    hasTime: due.date.includes('T'),
    timezone: due.timezone ?? null,
    recurring: !!due.is_recurring,
    string: due.string ?? '',
  };
}

function normalizeItem(item: TodoistItem): Task {
  return {
    id: item.id,
    content: item.content,
    description: item.description ?? '',
    projectId: item.project_id ?? null,
    sectionId: item.section_id ?? null,
    parentId: item.parent_id ?? null,
    order: item.child_order ?? 0,
    priority: fromTodoistPriority(item.priority ?? 1),
    labels: item.labels ?? [],
    due: normalizeDue(item.due),
    deadline: item.deadline?.date ?? null,
    duration: item.duration ?? null,
    addedAt: item.added_at ?? null,
  };
}

function normalizeCompleted(item: TodoistItem): CompletedTask {
  return {
    id: item.id,
    content: item.content,
    projectId: item.project_id ?? null,
    labels: item.labels ?? [],
    priority: fromTodoistPriority(item.priority ?? 1),
    completedAt: item.completed_at ?? new Date().toISOString(),
  };
}

function dueArgs(due: DueSpec | undefined): Record<string, unknown> {
  if (due === undefined) return {};
  if (due === null) return { due: null };
  const obj: Record<string, string> = {};
  if (due.string) obj.string = due.string;
  if (due.date) obj.date = due.date;
  return { due: obj };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class TodoistProvider implements TaskProvider {
  readonly id = 'todoist';

  constructor(private readonly token: string) {}

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
      throw new ProviderError('Todoist rate limit hit', 429, retryAfter);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError(`Todoist API ${res.status} on ${path}: ${body.slice(0, 300)}`, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private syncRequest(params: Record<string, string>): Promise<any> {
    return this.request('/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  }

  // ── Read: incremental sync ──

  async sync(syncToken: string | null): Promise<SyncResult> {
    const data = await this.syncRequest({
      sync_token: syncToken ?? '*',
      resource_types: RESOURCE_TYPES,
    });

    const items: TodoistItem[] = data.items ?? [];
    const projects: TodoistProject[] = data.projects ?? [];
    const sections: TodoistSection[] = data.sections ?? [];
    const labels: TodoistLabel[] = data.labels ?? [];

    // An item leaves the active set when deleted OR completed (checked).
    const activeItems = items.filter((i) => !i.is_deleted && !i.checked);
    const removedItems = items.filter((i) => i.is_deleted || i.checked);
    const completedItems = items.filter((i) => i.checked && !i.is_deleted);

    return {
      fullSync: !!data.full_sync,
      syncToken: data.sync_token,
      tasks: activeItems.map(normalizeItem),
      removedTaskIds: removedItems.map((i) => i.id),
      deletedTaskIds: items.filter((i) => i.is_deleted).map((i) => i.id),
      completed: completedItems.map(normalizeCompleted),
      projects: projects
        .filter((p) => !p.is_deleted && !p.is_archived)
        .map((p): Project => ({
          id: p.id,
          name: p.name,
          color: p.color,
          parentId: p.parent_id ?? null,
          order: p.child_order ?? 0,
          favorite: !!p.is_favorite,
          inbox: !!p.inbox_project,
        })),
      removedProjectIds: projects.filter((p) => p.is_deleted || p.is_archived).map((p) => p.id),
      sections: sections
        .filter((s) => !s.is_deleted && !s.is_archived)
        .map((s): Section => ({
          id: s.id,
          name: s.name,
          projectId: s.project_id,
          order: s.section_order ?? 0,
        })),
      removedSectionIds: sections.filter((s) => s.is_deleted || s.is_archived).map((s) => s.id),
      labels: labels
        .filter((l) => !l.is_deleted)
        .map((l): Label => ({
          id: l.id,
          name: l.name,
          color: l.color,
          order: l.item_order ?? 0,
        })),
      removedLabelIds: labels.filter((l) => l.is_deleted).map((l) => l.id),
    };
  }

  // ── Writes: sync commands (batched-capable, idempotent via uuid) ──

  private async command(
    type: string,
    args: Record<string, unknown>,
    tempId?: string,
  ): Promise<any> {
    const uuid = randomUUID();
    const cmd: Record<string, unknown> = { type, uuid, args };
    if (tempId) cmd.temp_id = tempId;

    const data = await this.syncRequest({ commands: JSON.stringify([cmd]) });
    const status = data.sync_status?.[uuid];
    if (status !== 'ok') {
      const msg = typeof status === 'object' ? JSON.stringify(status) : String(status);
      throw new ProviderError(`Todoist command ${type} failed: ${msg}`);
    }
    return data;
  }

  async createTask(draft: TaskDraft): Promise<string> {
    const tempId = randomUUID();
    const args: Record<string, unknown> = {
      content: draft.content,
      ...dueArgs(draft.due),
    };
    if (draft.description) args.description = draft.description;
    if (draft.projectId) args.project_id = draft.projectId;
    if (draft.sectionId) args.section_id = draft.sectionId;
    if (draft.parentId) args.parent_id = draft.parentId;
    if (draft.priority) args.priority = toTodoistPriority(draft.priority);
    if (draft.labels?.length) args.labels = draft.labels;
    if (draft.deadline) args.deadline = { date: draft.deadline };
    if (draft.duration) args.duration = draft.duration;

    const data = await this.command('item_add', args, tempId);
    return data.temp_id_mapping?.[tempId] ?? tempId;
  }

  async quickAdd(text: string): Promise<void> {
    await this.request('/tasks/quick_add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text }),
    });
  }

  async updateTask(id: string, patch: TaskPatch): Promise<void> {
    const args: Record<string, unknown> = { id, ...dueArgs(patch.due) };
    if (patch.content !== undefined) args.content = patch.content;
    if (patch.description !== undefined) args.description = patch.description;
    if (patch.priority !== undefined) args.priority = toTodoistPriority(patch.priority);
    if (patch.labels !== undefined) args.labels = patch.labels;
    if (patch.deadline !== undefined) args.deadline = patch.deadline ? { date: patch.deadline } : null;
    if (patch.duration !== undefined) args.duration = patch.duration;
    await this.command('item_update', args);
  }

  async completeTask(id: string): Promise<void> {
    // item_close = what official clients do: regular tasks complete,
    // recurring tasks advance to their next occurrence.
    await this.command('item_close', { id });
  }

  async uncompleteTask(id: string): Promise<void> {
    await this.command('item_uncomplete', { id });
  }

  async deleteTask(id: string): Promise<void> {
    await this.command('item_delete', { id });
  }

  async moveTask(id: string, dest: TaskMove): Promise<void> {
    // item_move accepts exactly one destination; prefer the most specific.
    const args: Record<string, unknown> = { id };
    if (dest.parentId) args.parent_id = dest.parentId;
    else if (dest.sectionId) args.section_id = dest.sectionId;
    else if (dest.projectId) args.project_id = dest.projectId;
    else return;
    await this.command('item_move', args);
  }

  // ── Completed history ──

  async fetchCompleted(since: string, until: string): Promise<CompletedTask[]> {
    const out: CompletedTask[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ since, until, limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const data = await this.request(`/tasks/completed/by_completion_date?${params}`);
      for (const item of data.items ?? []) out.push(normalizeCompleted(item));
      cursor = data.next_cursor ?? null;
    } while (cursor);
    return out;
  }
}

/** Resolve the configured provider, or null when no token is set yet. */
export function getTodoistToken(): string | null {
  // A token saved via Settings > Logins (encrypted store) wins over the env
  // var, so updating it in the UI takes effect without a container restart.
  try {
    const stored = getAccountSecrets('todoist').token ?? '';
    if (stored.trim()) return stored.trim();
  } catch {}
  const token =
    (import.meta as any).env?.TODOIST_API_TOKEN ?? process.env.TODOIST_API_TOKEN ?? '';
  return token.trim() ? token.trim() : null;
}
