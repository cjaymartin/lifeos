// Shared stack-agent lib: prompt assembly, tool gating, proposal parsing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/jobs/runner', () => ({ runAgentCapture: vi.fn() }));
vi.mock('@/lib/content-store', () => ({ loadStackContent: vi.fn(async () => '### grocery.json\n{"items":[]}') }));
vi.mock('@/features', () => ({
  stacks: [{ id: 'grocery', label: 'Groceries', chatTools: [] }],
  CHAT_BASE_TOOLS: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit'],
  loadChatGuide: vi.fn(async () => 'GROCERY GUIDE'),
}));

const { buildStackPrompt, parseProposal, resolveStackTools, runStackChat } = await import('@/lib/chat/stack-agent');
const { runAgentCapture } = await import('@/lib/jobs/runner');

beforeEach(() => vi.mocked(runAgentCapture).mockReset());

describe('parseProposal', () => {
  it('returns the text unchanged when there is no marker', () => {
    expect(parseProposal('just a plain reply')).toEqual({ cleanText: 'just a plain reply' });
  });

  it('extracts a trailing WRITE_PROPOSAL block', () => {
    const text = 'I\'ll add butter.\nWRITE_PROPOSAL: {"summary":"Add butter","files":[{"path":"grocery.json","description":"add butter"}]}';
    const { cleanText, proposal } = parseProposal(text);
    expect(cleanText).toBe("I'll add butter.");
    expect(proposal).toEqual({ summary: 'Add butter', files: [{ path: 'grocery.json', description: 'add butter' }] });
  });

  it('falls back to the raw text when the marker JSON is malformed', () => {
    const text = 'oops\nWRITE_PROPOSAL: {not json}';
    expect(parseProposal(text)).toEqual({ cleanText: text });
  });
});

describe('resolveStackTools', () => {
  it('withholds Write/Edit until approved', () => {
    expect(resolveStackTools('grocery', false)).not.toContain('Write');
    expect(resolveStackTools('grocery', false)).not.toContain('Edit');
    expect(resolveStackTools('grocery', false)).toContain('WebSearch');
  });
  it('grants Write/Edit once approved', () => {
    expect(resolveStackTools('grocery', true)).toEqual(expect.arrayContaining(['Write', 'Edit', 'WebSearch']));
  });
});

describe('buildStackPrompt', () => {
  it('scopes the prompt, loads content + guide, and asks for a proposal when unapproved', async () => {
    const prompt = await buildStackPrompt({ stackId: 'grocery', stackLabel: 'Groceries', message: 'add milk' });
    expect(prompt).toContain('You ONLY answer questions and perform actions related to Groceries');
    expect(prompt).toContain('WRITE_PROPOSAL:');
    expect(prompt).toContain('GROCERY GUIDE');
    expect(prompt).toContain('### grocery.json');
    expect(prompt).toContain('User: add milk');
  });

  it('switches to execute-now guidance when approved', async () => {
    const prompt = await buildStackPrompt({ stackId: 'grocery', stackLabel: 'Groceries', message: 'go', approved: true });
    expect(prompt).toContain('Execute all file writes now');
    expect(prompt).not.toContain('WRITE_PROPOSAL:');
  });

  it('honors content and guide overrides (used by the dashboard target)', async () => {
    const prompt = await buildStackPrompt({
      stackId: 'dashboard', stackLabel: 'Dashboard', message: 'what is my day',
      contentOverride: 'BRIEFING DUMP', chatGuideOverride: 'DASH GUIDE',
    });
    expect(prompt).toContain('BRIEFING DUMP');
    expect(prompt).toContain('DASH GUIDE');
    expect(prompt).not.toContain('GROCERY GUIDE');
  });
});

describe('runStackChat', () => {
  it('returns a parsed proposal in the unapproved phase', async () => {
    vi.mocked(runAgentCapture).mockResolvedValue(
      'Add butter?\nWRITE_PROPOSAL: {"summary":"Add butter","files":[{"path":"grocery.json","description":"add butter"}]}',
    );
    const res = await runStackChat({ stackId: 'grocery', stackLabel: 'Groceries', message: 'add butter' });
    expect(res.proposal?.files).toHaveLength(1);
    expect(res.reply).toBe('Add butter?');
    expect(res.rawReply).toContain('WRITE_PROPOSAL:');
  });

  it('does not parse a proposal once approved — it just returns the reply', async () => {
    vi.mocked(runAgentCapture).mockResolvedValue('Done — added butter.');
    const res = await runStackChat({ stackId: 'grocery', stackLabel: 'Groceries', message: 'go', approved: true });
    expect(res.proposal).toBeUndefined();
    expect(res.reply).toBe('Done — added butter.');
  });
});
