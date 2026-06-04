import { useState } from 'react';
import { CalendarClock, Flag, Repeat, Tag, Trash2 } from 'lucide-react';
import type { Project, Task } from '@/lib/tasks/types';
import {
  formatDueLabel,
  formatTime,
  isDueToday,
  isOverdue,
  PRIORITY_COLORS,
  providerColor,
} from './task-utils';

interface Props {
  task: Task;
  /** Shown in agenda/label views for context; omit in project view */
  project?: Project | null;
  depth?: number;
  onComplete: (id: string) => void;
  onUpdate: (id: string, body: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}

export default function TaskItem({ task, project, depth = 0, onComplete, onUpdate, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(task.content);
  const [description, setDescription] = useState(task.description);
  const [dueString, setDueString] = useState('');
  const [priority, setPriority] = useState<number>(task.priority);

  const pc = PRIORITY_COLORS[task.priority];
  const overdue = isOverdue(task.due);
  const today = isDueToday(task.due);
  const time = task.due ? formatTime(task.due) : null;

  const save = () => {
    const body: Record<string, unknown> = {};
    if (content.trim() && content !== task.content) body.content = content.trim();
    if (description !== task.description) body.description = description;
    if (priority !== task.priority) body.priority = priority;
    if (dueString.trim()) body.dueString = dueString.trim();
    if (Object.keys(body).length) onUpdate(task.id, body);
    setDueString('');
    setEditing(false);
  };

  return (
    <li style={depth ? { paddingLeft: depth * 24 } : undefined}>
      <div className="group flex items-start gap-2.5 py-2 border-b border-border/60">
        {/* complete */}
        <button
          onClick={() => onComplete(task.id)}
          aria-label="Complete task"
          className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 ${pc.ring}
                      hover:bg-accent/60 transition-colors flex items-center justify-center`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
               className={`w-2.5 h-2.5 opacity-0 group-hover:opacity-70 ${pc.text}`}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        {/* body */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditing((e) => !e)}>
          <p className="text-sm text-foreground leading-snug">{task.content}</p>
          {task.description && !editing && (
            <p className="text-xs text-muted-foreground truncate">{task.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
            {task.due && (
              <span
                className={`inline-flex items-center gap-1 text-xs ${
                  overdue ? 'text-destructive' : today ? 'text-emerald-500' : 'text-muted-foreground'
                }`}
              >
                <CalendarClock className="w-3 h-3" />
                {formatDueLabel(task.due)}
                {time && ` ${time}`}
                {task.due.recurring && <Repeat className="w-3 h-3" />}
              </span>
            )}
            {task.deadline && (
              <span className="text-xs text-warning">⚑ {task.deadline}</span>
            )}
            {task.labels.map((l) => (
              <span key={l} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <Tag className="w-3 h-3" />{l}
              </span>
            ))}
            {project && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                <span className="h-2 w-2 rounded-full" style={{ background: providerColor(project.color) }} />
                {project.name}
              </span>
            )}
          </div>
        </div>

        {task.priority < 4 && <Flag className={`w-3.5 h-3.5 mt-1 shrink-0 ${pc.text}`} />}
      </div>

      {/* inline editor */}
      {editing && (
        <div className="mb-2 mt-1 rounded-lg border border-border bg-card p-3 space-y-2">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="w-full bg-transparent text-sm text-foreground border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={2}
            className="w-full bg-transparent text-xs text-foreground border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary resize-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={dueString}
              onChange={(e) => setDueString(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={task.due ? `Due: ${task.due.string || task.due.date}` : 'Due, e.g. "tomorrow 9am"'}
              className="flex-1 min-w-32 bg-transparent text-xs text-foreground border border-border rounded px-2 py-1.5 focus:outline-none focus:border-primary"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="text-xs bg-card text-foreground border border-border rounded px-1.5 py-1.5"
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
              <option value={4}>P4</option>
            </select>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-2">
              <button onClick={save}
                      className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">
                Save
              </button>
              {task.due && (
                <button onClick={() => { onUpdate(task.id, { clearDue: true }); setEditing(false); }}
                        className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground">
                  Clear due
                </button>
              )}
              <button onClick={() => setEditing(false)}
                      className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
            <button onClick={() => onDelete(task.id)} aria-label="Delete task"
                    className="text-destructive/70 hover:text-destructive p-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
