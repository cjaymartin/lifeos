import type { Feature } from '@/features/types';
import { groceryJobs } from './jobs';

export const groceryFeature: Feature = {
  id: 'grocery',
  stack: {
    label: 'Groceries',
    icon: 'ShoppingBasket',
    href: '/grocery',
    description: 'Grocery list with staples and cart building',
    dashboardWidget: false, // sidebar only for now
    // Let the chat operate the user's real Walmart cart on demand (sync/add/
    // remove) via the single front door — the same CLI the /walmart-cart skill
    // uses. Scoped to that one command; never a general shell. The no-purchase
    // hard rule lives in chat.md.
    chatTools: ['Bash(node scripts/walmart.mjs:*)'],
  },
  jobs: groceryJobs,
  hasChatGuide: true, // chat.md: schemas, recipe cross-reads, the no-purchase hard rule
};
