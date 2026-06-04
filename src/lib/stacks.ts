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
    id: 'recipes',
    label: 'Recipes',
    icon: 'ChefHat',
    href: '/recipes',
    description: 'Saved recipes',
    dashboardWidget: true,
    // Recipes chat can search the web for images/inspiration and read/write recipe files
    chatTools: [],
  },
];
