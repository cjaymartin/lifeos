---
name: grocery-categorize
description: Micro-agent — assign unconfirmed grocery-list items to a default category and write src/content/grocery/.categorized.json for the server to apply.
---

# Grocery Categorize

Tiny, fast job: put uncategorized grocery items into the right aisle.

1. Read `src/content/grocery/grocery.json`.
2. Find items with `"categoryConfirmed": false`.
3. For each, pick the best category from exactly this list:
   `Produce, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, Frozen, Beverages, Snacks, Household, Personal Care, Other`
   Use common grocery-store layout sense (e.g. "tofu" → Produce or Pantry — pick the conventional aisle; "dog food" → Pantry is wrong, use Other if truly ambiguous... prefer the closest fit, reserve Other for genuinely unclassifiable items).
4. Write `src/content/grocery/.categorized.json` as a flat id → category map:

```json
{
  "tofu-a1b2c": "Produce",
  "dog-food-d4e5f": "Other"
}
```

- Include only the items you classified (the unconfirmed ones).
- Always write the file, even if it's `{}`.
- Do **not** modify grocery.json or any other file — the server merges your output.
- No web searching, no questions — this should take seconds.
