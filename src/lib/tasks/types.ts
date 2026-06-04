// Provider-agnostic task types. All providers (Todoist today, anything later)
// normalize into these shapes — the store, API routes, and UI only ever see them.

export interface TaskDue {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ss when hasTime */
  date: string;
  hasTime: boolean;
  timezone: string | null;
  recurring: boolean;
  /** Natural-language form, e.g. "every day at 10" — needed to preserve recurrence on reschedule */
  string: string;
}

export interface TaskDuration {
  amount: number;
  unit: 'minute' | 'day';
}

export interface Task {
  id: string;
  content: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  parentId: string | null;
  /** Order among siblings */
  order: number;
  /** Normalized: 1 = highest (UI "P1") … 4 = lowest/default ("P4") */
  priority: 1 | 2 | 3 | 4;
  labels: string[];
  due: TaskDue | null;
  /** Hard deadline, YYYY-MM-DD */
  deadline: string | null;
  duration: TaskDuration | null;
  addedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  order: number;
  favorite: boolean;
  inbox: boolean;
}

export interface Section {
  id: string;
  name: string;
  projectId: string;
  order: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface CompletedTask {
  id: string;
  content: string;
  projectId: string | null;
  labels: string[];
  priority: 1 | 2 | 3 | 4;
  completedAt: string;
}

/** The on-disk mirror — src/content/tasks/tasks.json */
export interface TasksSnapshot {
  provider: string;
  /** Provider's incremental sync cursor (opaque) */
  syncToken: string | null;
  lastSyncAt: string | null;
  /** Bumped on every change — clients use it to detect staleness */
  version: number;
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
}

export function emptySnapshot(provider: string): TasksSnapshot {
  return {
    provider,
    syncToken: null,
    lastSyncAt: null,
    version: 0,
    tasks: [],
    projects: [],
    sections: [],
    labels: [],
  };
}
