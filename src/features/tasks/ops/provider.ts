import type { CompletedTask, Label, Project, Section, Task, TaskDuration } from './types';

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  /** True when the result is a complete snapshot (replace local state wholesale) */
  fullSync: boolean;
  syncToken: string;
  /** Upserted active tasks */
  tasks: Task[];
  /** Tasks removed from the active set (deleted OR completed) */
  removedTaskIds: string[];
  /** Tasks actually deleted — purged from the completed log too */
  deletedTaskIds: string[];
  /** Tasks that were completed in this delta (subset context for the completed log) */
  completed: CompletedTask[];
  projects: Project[];
  removedProjectIds: string[];
  sections: Section[];
  removedSectionIds: string[];
  labels: Label[];
  removedLabelIds: string[];
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Due-date spec for writes.
 * - `{ string }` — natural language ("tomorrow 9am", "every monday")
 * - `{ date }` — explicit date (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
 * - `{ date, string }` — reschedule while preserving a recurrence pattern
 * - `null` — remove the due date
 */
export type DueSpec = { string?: string; date?: string } | null;

export interface TaskDraft {
  content: string;
  description?: string;
  projectId?: string;
  sectionId?: string;
  parentId?: string;
  priority?: 1 | 2 | 3 | 4; // 1 = highest
  labels?: string[];
  due?: DueSpec;
  deadline?: string | null; // YYYY-MM-DD
  duration?: TaskDuration | null;
}

export interface TaskPatch {
  content?: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  labels?: string[];
  due?: DueSpec;
  deadline?: string | null;
  duration?: TaskDuration | null;
}

export interface TaskMove {
  projectId?: string;
  sectionId?: string;
  parentId?: string;
}

// ─── Provider contract ───────────────────────────────────────────────────────

/**
 * Everything LifeOS needs from a task backend. Swapping Todoist out means
 * writing one new class that implements this and changing `getProvider()`.
 */
export interface TaskProvider {
  readonly id: string;

  /** Incremental sync. Pass null for an initial full sync. */
  sync(syncToken: string | null): Promise<SyncResult>;

  /** Create a task; returns the new task's id. */
  createTask(draft: TaskDraft): Promise<string>;
  /** Natural-language create (e.g. "Pay rent tomorrow p1 #Home"). Optional capability. */
  quickAdd?(text: string): Promise<void>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  completeTask(id: string): Promise<void>;
  uncompleteTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  moveTask(id: string, dest: TaskMove): Promise<void>;

  /** Completed-task history within [since, until] (ISO dates). */
  fetchCompleted(since: string, until: string): Promise<CompletedTask[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
