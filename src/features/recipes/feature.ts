import type { Feature } from '@/features/types';

export const recipesFeature: Feature = {
  id: 'recipes',
  stack: {
    label: 'Recipes',
    icon: 'ChefHat',
    href: '/recipes',
    description: 'Saved recipes',
    dashboardWidget: false, // sidebar only — no dashboard card
    // Recipes chat can search the web for images/inspiration and read/write recipe files
    chatTools: [],
  },
};
