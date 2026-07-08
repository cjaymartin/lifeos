import { describe, it, expect } from 'vitest';
import { resolveStackTools } from '@/lib/chat/stack-agent';

// The grocery chat must be able to operate the user's real Walmart cart on
// demand (sync/add/remove) through the on-demand CLI — not just edit local
// grocery files. Reads are safe pre-approval, so the grant is unconditional;
// the no-purchase hard rule lives in chat.md and the skill.
describe('grocery chat — live Walmart cart access', () => {
  it('grants the Walmart CLI even before write-approval (reads are safe)', () => {
    const tools = resolveStackTools('grocery', false);
    expect(tools.some((t) => /scripts\/walmart\.mjs/.test(t))).toBe(true);
  });

  it('still grants the Walmart CLI after approval', () => {
    const tools = resolveStackTools('grocery', true);
    expect(tools.some((t) => /scripts\/walmart\.mjs/.test(t))).toBe(true);
  });

  it('does not leak the Walmart CLI grant to unrelated stacks', () => {
    const tools = resolveStackTools('recipes', true);
    expect(tools.some((t) => /scripts\/walmart\.mjs/.test(t))).toBe(false);
  });
});
