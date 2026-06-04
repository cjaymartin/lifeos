export interface Stack {
  id: string;
  label: string;
  icon: string;
  href: string;
  description?: string;
  dashboardWidget?: boolean;
  // Tools the stack's chat assistant is allowed to use.
  // Merged with the base set: WebSearch, WebFetch, Read, Write.
  // Future stacks can add MCP tools, e.g. 'mcp__claude_ai_Todoist__*'
  chatTools?: string[];
}

// Base tools every stack chat gets
export const CHAT_BASE_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write'];

export const stacks: Stack[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'ListChecks',
    href: '/tasks',
    description: 'Live Todoist tasks',
    dashboardWidget: false, // the dashboard already has a dedicated live Tasks widget
    chatTools: [],
  },
  {
    id: 'deliveries',
    label: 'Deliveries',
    icon: 'Package',
    href: '/deliveries',
    description: 'Upcoming deliveries from Gmail',
    dashboardWidget: false, // the dashboard has a dedicated Deliveries widget (registry.json)
    chatTools: [],
  },
  {
    id: 'recipes',
    label: 'Recipes',
    icon: 'ChefHat',
    href: '/recipes',
    description: 'Saved recipes',
    dashboardWidget: false, // sidebar only — no dashboard card
    // Recipes chat can search the web for images/inspiration and read/write recipe files
    chatTools: [],
  },
];
