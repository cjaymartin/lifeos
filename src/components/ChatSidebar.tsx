'use client';
import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Loader2, X } from 'lucide-react';

interface Message { role: 'user' | 'assistant'; content: string }

interface Props { stackId: string; stackLabel: string }

const SUGGESTIONS: Record<string, string[]> = {
  recipes: ['What recipes do I have?', 'Add a new recipe', 'Suggest a substitution'],
  budget: ['What did I spend this month?', 'Show my top categories', 'How am I tracking vs budget?'],
  journal: ['What did I write about recently?', 'Summarize this week', 'Find entries about a topic'],
};

function getSuggestions(stackId: string): string[] {
  return SUGGESTIONS[stackId] ?? [
    `What's in my ${stackId}?`,
    `Add a new ${stackId} entry`,
    `Summarize my ${stackId}`,
  ];
}

export default function ChatSidebar({ stackId, stackLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, stackId, stackLabel, history: next.slice(-10) }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', content: data.reply ?? 'Something went wrong.' }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Failed to reach the server.' }]);
    } finally {
      setLoading(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const suggestions = getSuggestions(stackId);

  return (
    <div className="print:hidden">
      {/* Floating toggle tab */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? `Close ${stackLabel} assistant` : `Open ${stackLabel} assistant`}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-card border border-border border-r-0 rounded-l-lg px-1.5 py-3 text-muted-foreground hover:text-foreground shadow-sm transition-colors print:hidden"
      >
        <MessageSquare size={16} />
      </button>

      {/* Sliding panel */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-card border-l border-border shadow-lg z-50 flex flex-col transition-transform duration-150 ease-out print:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30 shrink-0">
          <MessageSquare size={15} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{stackLabel} Assistant</span>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close chat"
          >
            <X size={14} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-2">
              <MessageSquare size={28} className="text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Ask anything about your {stackLabel.toLowerCase()} data.
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {suggestions.map(q => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}>
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-3.5 py-2.5">
                <Loader2 size={14} className="text-muted-foreground animate-spin" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-3 flex gap-2 items-end shrink-0">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask anything…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[32px] max-h-[96px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
