import { describe, it, expect } from 'vitest';
import { features, stacks, CHAT_BASE_TOOLS, getFeature, loadChatGuide } from '@/features';

describe('feature registry', () => {
  it('feature ids are unique', () => {
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every stack-bearing feature mounts at /<id>', () => {
    for (const f of features) {
      if (f.stack) expect(f.stack.href.startsWith(`/${f.id}`)).toBe(true);
    }
  });

  it('derived stacks preserve the original sidebar order and shape', () => {
    expect(stacks.map((s) => s.id)).toEqual(['tasks', 'deliveries', 'recipes', 'grocery']);
    const grocery = stacks.find((s) => s.id === 'grocery')!;
    expect(grocery.label).toBe('Groceries');
    expect(grocery.icon).toBe('ShoppingBasket');
    expect(grocery.href).toBe('/grocery');
  });

  it('the chat base toolset is unchanged', () => {
    expect(CHAT_BASE_TOOLS).toEqual(['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit']);
  });

  it('daily is a widgets-only feature (no stack)', () => {
    expect(getFeature('daily')).toBeDefined();
    expect(getFeature('daily')!.stack).toBeUndefined();
  });

  it('features own their agent jobs', () => {
    expect(Object.keys(getFeature('grocery')!.jobs ?? {})).toEqual(
      expect.arrayContaining(['build-carts', 'purchase-scan', 'categorize']),
    );
    expect(getFeature('deliveries')!.jobs).toHaveProperty('populate-deliveries');
    expect(getFeature('daily')!.jobs).toHaveProperty('populate-daily');
  });
});

describe('chat guides (per-feature chat.md)', () => {
  it('grocery chat guide carries the hard no-purchase rule', async () => {
    const guide = await loadChatGuide('grocery');
    expect(guide).toContain('HARD RULE');
    expect(guide).toContain('never place, submit, or check out an order');
  });

  it('features without a chat.md yield empty guidance', async () => {
    expect(await loadChatGuide('tasks')).toBe('');
    expect(await loadChatGuide('nonexistent')).toBe('');
  });
});
