---
name: grocery-purchase-scan
description: Scan Gmail for recent Walmart/Amazon order confirmations, match purchased products to grocery-list items, and write src/content/grocery/.scan-results.json for the server to apply.
---

# Grocery Purchase Scan

Detect what the user actually bought (Walmart / Amazon order-confirmation emails) and report which grocery-list items those purchases cover. The server applies the results — removing items from the list, restocking staples, and logging to purchases.json — so you only **read** state and write one results file.

## Step 1 — Read the list

Read `src/content/grocery/grocery.json` and `src/content/grocery/staples.json`. If the list is empty, write `{ "purchases": [] }` to `src/content/grocery/.scan-results.json` and stop.

## Step 2 — Search Gmail (last 7 days)

Use `mcp__claude_ai_Gmail__search_threads`:

1. `newer_than:7d from:walmart.com subject:("thanks for your order" OR "order confirmation" OR "your order" OR shipped OR delivered)`
2. `newer_than:7d from:amazon.com subject:("your order" OR ordered OR "order confirmation" OR shipped)`

For promising threads use `mcp__claude_ai_Gmail__get_thread` and extract the **line items** (product names) plus order number and order date. Only count **order confirmations** (a purchase happened) — ignore shipping-status updates for orders you've already counted, marketing, cart-reminder, and refund emails.

## Step 3 — Match purchases to list items

For each purchased product, check whether it plausibly covers an item on the grocery list — match loosely ("Great Value 2% Reduced Fat Milk 1 Gal" covers "milk"; "AAA batteries 24-pack" covers "batteries"). One purchased product can cover at most one list item; pick the best fit. Skip purchases that don't correspond to anything on the list.

## Step 4 — Write the results file

Write `src/content/grocery/.scan-results.json`:

```json
{
  "purchases": [
    {
      "name": "milk",
      "retailer": "walmart",
      "orderId": "2000123-456789",
      "date": "2026-06-04",
      "matchedItemIds": ["milk-x7k2p"]
    }
  ]
}
```

- `matchedItemIds` — the exact `id`s from grocery.json this purchase covers (usually one).
- `name` — the list item's name (helps the server fall back to name matching).
- Always write the file, even with an empty `purchases` array — the UI waits on this run to finish.
- Do **not** modify grocery.json, staples.json, or any other file — the server applies the changes.
