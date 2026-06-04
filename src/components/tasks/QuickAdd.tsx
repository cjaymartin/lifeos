import { useState } from 'react';
import { Plus } from 'lucide-react';

interface Props {
  /** When set (project view), new tasks land in this project */
  projectId?: string;
  onAdd: (body: Record<string, unknown>) => Promise<void>;
}

export default function QuickAdd({ projectId, onAdd }: Props) {
  const [content, setContent] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { content: text };
      if (due.trim()) body.due = { string: due.trim() };
      if (projectId) body.projectId = projectId;
      await onAdd(body);
      setContent('');
      setDue('');
    } catch {
      // error surfaced by the hook; keep input so nothing is lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
      <input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder="Add a task…"
        disabled={busy}
        className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      <input
        value={due}
        onChange={(e) => setDue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder='due — "tomorrow 9am"'
        disabled={busy}
        className="w-36 bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/40 border-l border-border pl-2 focus:outline-none focus:text-foreground"
      />
      <button
        onClick={() => void submit()}
        disabled={busy || !content.trim()}
        className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90"
      >
        {busy ? '…' : 'Add'}
      </button>
    </div>
  );
}
