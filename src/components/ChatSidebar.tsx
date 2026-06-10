'use client';
import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Loader2, X, Pencil, Check, Trash2 } from 'lucide-react';
import { chatHistory } from '@/lib/client/chat-history';

interface Proposal {
  summary: string;
  files: { path: string; description: string }[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  // Present when the assistant is asking permission to make changes
  proposal?: Proposal;
  // The assistant's raw reply (incl. the proposal marker) — sent back on approval
  rawReply?: string;
  // 'pending' → buttons shown; 'approved'/'declined' → resolved badge
  proposalStatus?: 'pending' | 'approved' | 'declined';
}

interface Props { stackId: string; stackLabel: string; currentPath?: string; pageTitle?: string }

const SUGGESTIONS: Record<string, string[]> = {
  recipes: ['What recipes do I have?', 'Add a new recipe', 'Suggest a substitution'],
  budget: ['What did I spend this month?', 'Show my top categories', 'How am I tracking vs budget?'],
  journal: ['What did I write about recently?', 'Summarize this week', 'Find entries about a topic'],
  grocery: ['Add ingredients for tacos', 'What am I low on?', 'Plan a dinner from my recipes'],
};

function getSuggestions(stackId: string): string[] {
  return SUGGESTIONS[stackId] ?? [
    `What's in my ${stackId}?`,
    `Add a new ${stackId} entry`,
    `Summarize my ${stackId}`,
  ];
}

export default function ChatSidebar({ stackId, stackLabel, currentPath, pageTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Don't persist until the saved conversation has been restored, or the initial
  // empty state would overwrite it before it loads.
  const hydrated = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  // Restore the saved conversation for this stack on mount.
  useEffect(() => {
    let cancelled = false;
    hydrated.current = false;
    chatHistory.load(stackId).then(saved => {
      if (cancelled) return;
      if (saved.length) setMessages(saved);
    }).catch(err => {
      // A failed restore must not leave persistence permanently disabled —
      // flip hydrated anyway so subsequent messages still save.
      console.error('chat-history: failed to restore conversation', err);
    }).finally(() => {
      if (!cancelled) hydrated.current = true;
    });
    return () => { cancelled = true; };
  }, [stackId]);

  // Persist after every change, once restored. Empty state is represented by the
  // file's absence (see clearChat), so we never write an empty conversation.
  useEffect(() => {
    if (!hydrated.current || messages.length === 0) return;
    chatHistory.save(stackId, messages).catch(err =>
      console.error('chat-history: failed to persist conversation', err));
  }, [messages, stackId]);

  async function callChat(message: string, history: Message[], approved: boolean) {
    setLoading(true);
    abortRef.current = new AbortController();
    const timer = setTimeout(() => abortRef.current?.abort(), 300_000);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message, stackId, stackLabel, currentPath, pageTitle, approved,
          // Use rawReply for proposal messages so the model sees its own plan
          history: history.slice(-10).map(m => ({ role: m.role, content: m.rawReply ?? m.content })),
        }),
        signal: abortRef.current.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.type === 'proposal' && data.proposal) {
        setMessages(m => [...m, {
          role: 'assistant',
          content: data.reply || data.proposal.summary,
          proposal: data.proposal,
          rawReply: data.rawReply,
          proposalStatus: 'pending',
        }]);
      } else {
        setMessages(m => [...m, { role: 'assistant', content: data.reply ?? 'Something went wrong.' }]);
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out after 5 minutes.'
        : 'Failed to reach the server.';
      setMessages(m => [...m, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    await callChat(text, next, false);
  }

  async function approve(index: number) {
    if (loading) return;
    setMessages(m => m.map((msg, i) => i === index ? { ...msg, proposalStatus: 'approved' as const } : msg));
    const history = messages.slice(0, index + 1);
    await callChat(
      'I approve — please go ahead and make those changes now.',
      [...history, { role: 'user', content: 'I approve — please go ahead and make those changes now.' }],
      true
    );
  }

  function decline(index: number) {
    setMessages(m => [
      ...m.map((msg, i) => i === index ? { ...msg, proposalStatus: 'declined' as const } : msg),
      { role: 'assistant', content: 'No problem — I won\'t make any changes. Let me know if you\'d like something different.' },
    ]);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function clearChat() {
    if (loading) return;
    setMessages([]);
    await chatHistory.clear(stackId).catch(err =>
      console.error('chat-history: failed to clear conversation', err));
    inputRef.current?.focus();
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
          <div className="ml-auto flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                disabled={loading}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                aria-label="Clear chat"
                title="Clear conversation"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close chat"
            >
              <X size={14} />
            </button>
          </div>
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
                {m.proposal && (
                  <div className="mt-3 rounded-lg border border-border bg-card p-3 space-y-2 whitespace-normal">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Pencil size={12} className="text-muted-foreground shrink-0" />
                      Changes I&apos;d like to make
                    </div>
                    <ul className="space-y-1">
                      {m.proposal.files.map((f, fi) => (
                        <li key={fi} className="text-xs text-muted-foreground leading-relaxed">
                          • {f.description}
                        </li>
                      ))}
                    </ul>
                    {m.proposalStatus === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => approve(i)}
                          disabled={loading}
                          className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
                        >
                          <Check size={12} /> Approve
                        </button>
                        <button
                          onClick={() => decline(i)}
                          disabled={loading}
                          className="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                        >
                          Not now
                        </button>
                      </div>
                    )}
                    {m.proposalStatus === 'approved' && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                        <Check size={12} /> Approved
                      </div>
                    )}
                    {m.proposalStatus === 'declined' && (
                      <div className="text-xs text-muted-foreground pt-1">Dismissed</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-3.5 py-2.5 flex items-center gap-2">
                <Loader2 size={14} className="text-muted-foreground animate-spin shrink-0" />
                <span className="text-xs text-muted-foreground">
                  {elapsed < 5 ? 'Thinking…' : elapsed < 15 ? 'Working…' : `Working… ${elapsed}s`}
                </span>
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
