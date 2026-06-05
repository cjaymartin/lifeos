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
  // Extra stack-specific instructions appended to the chat system prompt
  // (data schemas, cross-stack reads, hard rules like "never purchase").
  chatGuidance?: string;
}

// Base tools every stack chat gets. Edit matters: models naturally reach for
// Edit on existing JSON files — without it every edit is permission-denied
// headless (and the model may claim success anyway).
export const CHAT_BASE_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit'];

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
  {
    id: 'grocery',
    label: 'Groceries',
    icon: 'ShoppingBasket',
    href: '/grocery',
    description: 'Grocery list with staples and cart building',
    dashboardWidget: false, // sidebar only for now
    chatTools: [],
    chatGuidance: `You may also read recipes in src/content/recipes/ and search the web for recipes — when the user wants ingredients for a meal, check what's already on the list and propose adding only what's missing.
The list lives in grocery.json: { "lastUpdated": ISO, "items": [{ "id", "name", "quantity"?, "note"?, "category", "categoryConfirmed", "staple", "checked", "addedAt", "source" }] }.
Categories must be one of: Produce, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, Frozen, Beverages, Snacks, Household, Personal Care, Other.
New item ids: kebab-case name plus a short random suffix (e.g. "ground-beef-x7k2p"). Set "source": "chat" (or "recipe" when pulled from a recipe), "checked": false, "categoryConfirmed": true, "addedAt": current ISO timestamp. Preserve all existing items when writing.
Staples live in staples.json ({ "staples": [{ "id", "name", "category", "status": "stocked"|"low"|"out", "lastPurchased"? }] }).
HARD RULE: never place, submit, or check out an order anywhere, and never enter payment or login details — building carts, links, and lists is fine; purchasing is strictly the user's own action.`,
  },
];
