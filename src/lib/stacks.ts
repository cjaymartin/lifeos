export interface Stack {
  id: string;
  label: string;
  icon: string;
  href: string;
  description?: string;
  dashboardWidget?: boolean;
}

export const stacks: Stack[] = [
  {
    id: 'recipes',
    label: 'Recipes',
    icon: 'ChefHat',
    href: '/recipes',
    description: 'Saved recipes',
    dashboardWidget: true,
  },
];
