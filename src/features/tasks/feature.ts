import type { Feature } from '@/features/types';

export const tasksFeature: Feature = {
  id: 'tasks',
  stack: {
    label: 'Tasks',
    icon: 'ListChecks',
    href: '/tasks',
    description: 'Live Todoist tasks',
    dashboardWidget: false, // the dashboard already has a dedicated live Tasks widget
    chatTools: [],
  },
};
