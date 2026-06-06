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
    chatTools: [],
  },
  jobs: groceryJobs,
  hasChatGuide: true, // chat.md: schemas, recipe cross-reads, the no-purchase hard rule
};
