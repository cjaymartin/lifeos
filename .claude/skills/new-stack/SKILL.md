---
name: new-stack
description: Scaffold a new LifeOS stack — creates the Astro pages, React components, content schema, and registers it in the sidebar. APP MODE only.
---

# New Stack Scaffolder

This skill creates a complete new stack for LifeOS. A "stack" is a folder-app — a section of the app that does one thing (Recipes, Budget, Tasks, etc.).

## Steps

You are in **APP MODE**. Do not touch any data files in `src/content/`.

### 1. Clarify (if args are missing)

If the user didn't provide a stack name, ask for:
- **Name** — e.g. "Recipes", "Budget", "Reading List"
- **Icon** — a Lucide icon name (e.g. `ChefHat`, `Wallet`, `BookOpen`). Pick a sensible default if they don't specify.
- **Description** — one line, shown in the sidebar tooltip and dashboard card
- **Dashboard widget?** — should this stack show a summary card on the home dashboard? Default: yes.

### 2. Derive identifiers

From the name, derive:
- `id` — lowercase, hyphenated slug (e.g. `reading-list`)
- `href` — `/<id>` (e.g. `/reading-list`)
- `contentDir` — `src/content/<id>/` (e.g. `src/content/reading-list/`)

### 3. Create files

Create the following files. Keep them minimal — the user will flesh them out:

**`src/pages/<id>/index.astro`**
```astro
---
import AppLayout from '@/layouts/AppLayout.astro';
// import content here once you have data files

const title = '<Name>';
---
<AppLayout title={title}>
  <div class="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
    <h1 class="text-2xl font-semibold text-foreground">{title}</h1>
    <p class="text-sm text-muted-foreground">No entries yet.</p>
  </div>
</AppLayout>
```

**`src/content/<id>/.gitkeep`** — empty file to create the directory

### 4. Register the stack

Edit `src/lib/stacks.ts` and add an entry to the `stacks` array:

```typescript
{
  id: '<id>',
  label: '<Name>',
  icon: '<Icon>',
  href: '/<id>',
  description: '<one-line description>',
  dashboardWidget: true,  // or false if user said no
},
```

### 5. Build and verify

Run `npm run build`. If it fails, fix the error before finishing.

### 6. Report

Tell the user:
- What files were created
- The URL to visit: `http://localhost:4321/<id>`
- What to say next: "Ask me to build out the [Name] stack" or "Ask me to add a [Name] entry"
- Remind them: to add data entries, use `/journal` / `/recipe` or just say "add a [Name] entry" — that's DATA MODE

## Notes

- Never create a stack that already exists in `src/lib/stacks.ts`
- Always use Lucide icon names — verify the icon exists in the lucide-react package if unsure
- The `dashboardWidget` flag makes the stack appear on the home dashboard — only enable it for stacks that will have meaningful summary data
