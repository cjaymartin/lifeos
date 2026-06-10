// Dashboard hand-off orchestrator: routing, parallel delegation, proposal
// aggregation, and faithful approval replay via HANDOFF_CONTEXT.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/jobs/runner', () => ({ runAgentCapture: vi.fn() }));
vi.mock('@/lib/chat/stack-agent', () => ({ runStackChat: vi.fn() }));
vi.mock('@/lib/content-store', () => ({ loadStackContent: vi.fn(async () => '') }));
vi.mock('@/features', () => ({
  stacks: [
    { id: 'tasks', label: 'Tasks', description: 'tasks' },
    { id: 'deliveries', label: 'Deliveries', description: 'deliveries' },
    { id: 'recipes', label: 'Recipes', description: 'recipes' },
    { id: 'grocery', label: 'Groceries', description: 'grocery list' },
  ],
  loadChatGuide: vi.fn(async () => ''),
}));

const { heuristicRoute, routeQuestion, runDashboardChat } = await import('@/lib/chat/dashboard-agent');
const { runAgentCapture } = await import('@/lib/jobs/runner');
const { runStackChat } = await import('@/lib/chat/stack-agent');

const proposal = (file: string) => ({ summary: `change ${file}`, files: [{ path: file, description: `edit ${file}` }] });

beforeEach(() => {
  vi.mocked(runAgentCapture).mockReset();
  vi.mocked(runStackChat).mockReset();
});

describe('heuristicRoute', () => {
  it('maps keywords to the right areas', () => {
    expect(heuristicRoute('what is on my grocery list?')).toEqual(['grocery']);
    expect(heuristicRoute('what should I cook for dinner')).toEqual(['recipes']);
    expect(heuristicRoute('tell me a joke')).toEqual([]);
  });
  it('can fan out to multiple areas', () => {
    const r = heuristicRoute('what tasks are due today?');
    expect(r).toContain('tasks');
    expect(r).toContain('dashboard'); // "today"
  });
});

describe('routeQuestion', () => {
  it('uses the router agent verdict when parseable', async () => {
    vi.mocked(runAgentCapture).mockResolvedValue('{"targets":["grocery","recipes"]}');
    expect(await routeQuestion('plan dinner', [])).toEqual(['grocery', 'recipes']);
  });
  it('falls back to the heuristic when the router output is empty', async () => {
    vi.mocked(runAgentCapture).mockResolvedValue('');
    expect(await routeQuestion('add milk to my list', [])).toEqual(['grocery']);
  });
  it('falls back to the heuristic when the router throws', async () => {
    vi.mocked(runAgentCapture).mockRejectedValue(new Error('spawn failed'));
    expect(await routeQuestion('any deliveries coming?', [])).toEqual(['deliveries']);
  });
});

describe('runDashboardChat — propose phase', () => {
  it('delegates to one page-agent, synthesizes, and surfaces its proposal with handoff context', async () => {
    vi.mocked(runAgentCapture)
      .mockResolvedValueOnce('{"targets":["grocery"]}') // router
      .mockResolvedValueOnce('Sure — I can add butter.'); // synthesis
    vi.mocked(runStackChat).mockResolvedValue({ reply: 'butter', rawReply: 'RAW_GROCERY', proposal: proposal('grocery.json') });

    const res = await runDashboardChat({ message: 'add butter', history: [{ role: 'user', content: 'add butter' }] });

    expect(vi.mocked(runStackChat)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runStackChat).mock.calls[0][0]).toMatchObject({ stackId: 'grocery', approved: false });
    expect(res.type).toBe('proposal');
    expect(res.reply).toBe('Sure — I can add butter.');
    expect(res.proposal?.files).toHaveLength(1);
    expect(res.rawReply).toContain('HANDOFF_CONTEXT:');
    expect(res.rawReply).toContain('RAW_GROCERY');
    expect(res.rawReply).toContain('grocery');
  });

  it('aggregates proposals across multiple page-agents', async () => {
    vi.mocked(runAgentCapture)
      .mockResolvedValueOnce('{"targets":["grocery","recipes"]}')
      .mockResolvedValueOnce('Combined answer.');
    vi.mocked(runStackChat).mockImplementation(async (opts: any) => ({
      reply: opts.stackId,
      rawReply: `RAW_${opts.stackId}`,
      proposal: proposal(`${opts.stackId}.json`),
    }));

    const res = await runDashboardChat({ message: 'plan dinner and add what I need', history: [{ role: 'user', content: 'plan dinner' }] });

    expect(vi.mocked(runStackChat)).toHaveBeenCalledTimes(2);
    expect(res.type).toBe('proposal');
    expect(res.proposal?.files).toHaveLength(2);
    expect(res.rawReply).toContain('RAW_grocery');
    expect(res.rawReply).toContain('RAW_recipes');
  });

  it('returns a plain reply (no proposal) when no page-agent proposes a write', async () => {
    vi.mocked(runAgentCapture)
      .mockResolvedValueOnce('{"targets":["grocery"]}')
      .mockResolvedValueOnce('You have milk and eggs.');
    vi.mocked(runStackChat).mockResolvedValue({ reply: 'milk, eggs', rawReply: 'milk, eggs' });

    const res = await runDashboardChat({ message: "what's on my list?", history: [{ role: 'user', content: "what's on my list?" }] });

    expect(res.type).toBeUndefined();
    expect(res.proposal).toBeUndefined();
    expect(res.reply).toBe('You have milk and eggs.');
  });

  it('answers general/web questions directly with no page-agents', async () => {
    vi.mocked(runAgentCapture)
      .mockResolvedValueOnce('{"targets":[]}') // router → none
      .mockResolvedValueOnce('Buttermilk substitute: milk + lemon juice.'); // direct synthesis
    const res = await runDashboardChat({ message: 'what is a buttermilk substitute?', history: [{ role: 'user', content: 'q' }] });

    expect(vi.mocked(runStackChat)).not.toHaveBeenCalled();
    expect(res.reply).toBe('Buttermilk substitute: milk + lemon juice.');
  });
});

describe('runDashboardChat — approval phase', () => {
  it('replays exactly the proposed plan per area, with that area\'s rawReply', async () => {
    vi.mocked(runStackChat).mockResolvedValue({ reply: 'Added butter.', rawReply: 'done' });
    vi.mocked(runAgentCapture).mockResolvedValue('Done — butter is on your list.'); // confirmation synthesis

    const history = [
      { role: 'user', content: 'add butter' },
      { role: 'assistant', content: 'Sure.\nHANDOFF_CONTEXT:[{"id":"grocery","rawReply":"RAW_GROCERY_PLAN"}]' },
      { role: 'user', content: 'I approve' },
    ];
    const res = await runDashboardChat({ message: 'I approve', history, approved: true });

    expect(vi.mocked(runStackChat)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runStackChat).mock.calls[0][0] as any;
    expect(call).toMatchObject({ stackId: 'grocery', approved: true });
    // the area's own plan is replayed as the assistant turn it executes against
    expect(call.history).toEqual(expect.arrayContaining([{ role: 'assistant', content: 'RAW_GROCERY_PLAN' }]));
    expect(res.reply).toBe('Done — butter is on your list.');
  });

  it('answers plainly when an approval arrives with no handoff context', async () => {
    vi.mocked(runAgentCapture).mockResolvedValue('Nothing to apply.');
    const res = await runDashboardChat({
      message: 'I approve',
      history: [{ role: 'assistant', content: 'no proposal here' }, { role: 'user', content: 'I approve' }],
      approved: true,
    });
    expect(vi.mocked(runStackChat)).not.toHaveBeenCalled();
    expect(res.reply).toBe('Nothing to apply.');
  });
});
