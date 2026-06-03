'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Bot, ChefHat, Loader2, X } from 'lucide-react';

interface Message { role: 'user' | 'assistant'; content: string }

interface Props { recipeSlug?: string; recipeTitle?: string }

export default function RecipeChat({ recipeSlug, recipeTitle }: Props) {
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
      const res = await fetch('/api/recipes/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, slug: recipeSlug, history: next.slice(-10) }),
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

  return (
    <div className="print:hidden">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bot size={15} />
        {open ? 'Close chat' : 'Ask about recipes'}
      </button>

      {!open ? null : (
        <div className="mt-3 rounded-xl border border-border bg-card overflow-hidden flex flex-col" style={{ height: '420px' }}>

          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
            <ChefHat size={15} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Recipe Assistant</span>
            {recipeTitle && (
              <span className="text-xs text-muted-foreground ml-1">· {recipeTitle}</span>
            )}
            <button onClick={() => setOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-2">
                <Bot size={28} className="text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {recipeTitle
                    ? `Ask anything about "${recipeTitle}", or request changes, substitutions, scaling tips, and more.`
                    : 'Ask about your recipes, request a new one, or get cooking help.'}
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {['What can I substitute for xanthan gum?', 'Scale this to 3 servings', 'Add a vanilla protein Creami recipe'].map(q => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                    >{q}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
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
          <div className="border-t border-border p-3 flex gap-2 items-end">
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
            >
              <Send size={14} />
            </button>
          </div>

        </div>
      )}
    </div>
  );
}
