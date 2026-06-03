---
name: recipe
description: DATA MODE — save a recipe to src/content/recipes/. Creates a clean markdown file. Does not touch any UI code.
---

# Recipe Entry (DATA MODE)

You are acting as the **database administrator**. Do not write or modify any `.astro`, `.tsx`, or other UI files. Only create/update files in `src/content/recipes/`.

## Step 1 — Collect the recipe

If the user hasn't provided the full recipe, ask for:
- **Name** — full recipe name
- **Source** — URL, book, or "original"
- **Servings**
- **Prep time** and **cook time**
- **Tags** — comma-separated (e.g. `chicken, weeknight, italian`)
- **Ingredients** — list, with amounts
- **Instructions** — numbered steps
- **Notes** — any tips, substitutions, storage info (optional)

If the user pastes a URL, use WebFetch to extract the recipe details from the page.

## Step 2 — Derive the slug

From the recipe name, create a lowercase hyphenated slug:
- "Chicken Parmesan" → `chicken-parmesan`
- "Mom's Apple Pie" → `moms-apple-pie`

Check that `src/content/recipes/<slug>.md` doesn't already exist. If it does, confirm with the user before overwriting.

## Step 3 — Write the file

Create `src/content/recipes/<slug>.md`:

```markdown
---
title: "<Recipe Name>"
slug: "<slug>"
source: "<URL or attribution>"
servings: <number>
prepTime: "<e.g. 15 minutes>"
cookTime: "<e.g. 45 minutes>"
tags: [<"tag1">, <"tag2">]
dateAdded: "<YYYY-MM-DD>"
---

## Ingredients

- <amount> <ingredient>
- ...

## Instructions

1. <Step one.>
2. <Step two.>
...

## Notes

<Any tips, substitutions, or storage instructions. Omit section if none.>
```

## Step 4 — Confirm

Tell the user:
- The file path created
- The tags applied
- Remind them that once the Recipes stack is built, this will appear at `/recipes/<slug>`

## Rules

- Never run `npm run build` — data files don't require a rebuild
- Never modify `src/lib/stacks.ts` or any page files
- If a URL is provided, fetch and extract — don't ask the user to re-type ingredients they've already given you a source for
- Preserve the exact ingredient amounts and instruction wording from the source
