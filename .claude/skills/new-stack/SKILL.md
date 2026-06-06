---
name: new-stack
description: Scaffold a new LifeOS feature with a stack — creates the feature folder (manifest, optional chat.md), the Astro page, the content dir, and registers it in the feature registry. APP MODE only.
---

# New Stack Scaffolder

This skill creates a new **Feature** with a **Stack** for LifeOS. Vocabulary is defined in `CONTEXT.md`: a Feature is the unit of composition (one folder under `src/features/<id>/`); a Stack is the feature's sidebar entry + page + chat mount. The architecture conventions live in `CLAUDE.md` → "Architecture: Features".

## Steps

You are in **APP MODE**. Do not touch any data files in `src/content/`.

### 1. Clarify (if args are missing)

If the user didn't provide a name, ask for:
- **Name** — e.g. "Recipes", "Budget", "Reading List"
- **Icon** — a Lucide icon name (e.g. `ChefHat`, `Wallet`, `BookOpen`). Pick a sensible default if they don't specify.
- **Description** — one line, shown in the sidebar tooltip and dashboard card
- **Dashboard card?** — should this stack show a card in the dashboard's Stacks strip? Default: yes.

### 2. Derive identifiers

From the name, derive:
- `id` — lowercase, hyphenated slug (e.g. `reading-list`)
- `href` — `/<id>` (e.g. `/reading-list`)
- `contentDir` — `src/content/<id>/` (e.g. `src/content/reading-list/`)

### 3. Create files

Create the following. Keep them minimal — the user will flesh them out:

**`src/features/<id>/feature.ts`** — the manifest:
```typescript
import type { Feature } from '@/features/types';

export const <camelId>Feature: Feature = {
  id: '<id>',
  stack: {
    label: '<Name>',
    icon: '<Icon>',
    href: '/<id>',
    description: '<one-line description>',
    dashboardWidget: true, // or false if user said no
    chatTools: [],
  },
};
```

**`src/pages/<id>/index.astro`**
```astro
---
import AppLayout from '@/layouts/AppLayout.astro';
// import the feature's ops here once it has data files

const title = '<Name>';
---
<AppLayout title={title}>
  <div class="p-6 md:p-10 max-w-5xl mx-auto space-y-6">
    <h1 class="text-2xl font-semibold text-foreground">{title}</h1>
    <p class="text-sm text-muted-foreground">No entries yet.</p>
  </div>
</AppLayout>
```

**`src/content/<id>/.gitkeep`** — empty file to create the content dir

**`src/features/<id>/chat.md`** *(optional — only if the user describes chat behavior)* — guidance appended to the feature's chat-assistant system prompt: data schemas, cross-feature reads, hard rules. The chat works without it.

### 4. Register the feature

Edit `src/features/index.ts`: import the new manifest and add it to the `features` array. Order matters — stack-bearing features render in the sidebar in array order, so place it where it belongs in the nav.

### 5. Build and verify

Run `npm run build` and `npm test`. The feature-registry tests (`tests/unit/features.test.ts`) assert unique ids and that every stack mounts at `/<id>` — if the sidebar-order test fails because you added a stack, update its expected order list to include the new id. Fix any other failure before finishing.

### 6. Report

Tell the user:
- What files were created
- The URL to visit: `http://localhost:4321/<id>`
- What to say next: "Ask me to build out the [Name] stack" or "Ask me to add a [Name] entry"
- Remind them: to add data entries, use `/journal` / `/recipe` or just say "add a [Name] entry" — that's DATA MODE

## Growing the feature later

These are NOT part of scaffolding — point the user at them when the feature grows (existing features are the templates):

- **`ops.ts`** — server domain logic; the only code that knows the feature's content-file shapes (`src/features/grocery/ops.ts`)
- **`client.ts`** — typed browser client built on `@/lib/client/stack-client`; the only code that knows the feature's API route URLs (`src/features/deliveries/client.ts`)
- **`jobs.ts`** — agent-job definitions via `defineAgentJob` from `@/lib/jobs/runner`, plus `jobs: {...}` in the manifest (`src/features/deliveries/jobs.ts`); watch them client-side with `@/lib/client/job-watch`
- **`widgets/*.astro`** — dashboard render adapters; add the type to the renderer map in `src/pages/index.astro` and a config entry in `src/content/widgets/registry.json` (`src/features/daily/widgets/`)

## Notes

- Never create a feature whose id already exists in `src/features/index.ts`
- Always use Lucide icon names — verify the icon exists in the lucide-react package if unsure
- `dashboardWidget` only controls the Stacks strip card on the dashboard — real summary widgets are `widgets/*.astro` adapters
- A feature can also be widgets-only (no `stack` field) — see `src/features/daily/feature.ts`; that's outside this skill's scope
