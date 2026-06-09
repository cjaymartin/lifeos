---
name: grocery-purchase-scan
description: Scan Gmail for recent Walmart/Amazon order confirmations AND item-unavailable/refund notices, match them to grocery-list items, and write src/content/grocery/.scan-results.json for the server to apply.
---

# Grocery Purchase Scan

Detect what the user actually bought (Walmart / Amazon order-confirmation emails) **and** what an order *didn't* deliver (Walmart "item unavailable / refunded / not fulfilled" notices), and report which grocery-list items each covers. The server applies the results — removing bought items, restocking staples, logging to purchases.json, and **re-adding** unavailable items — so you only **read** state and write one results file.

## Step 1 — Read the list

Read `src/content/grocery/grocery.json` and `src/content/grocery/staples.json`. If the list is empty, write `{ "purchases": [] }` to `src/content/grocery/.scan-results.json` and stop.

## Step 2 — Search Gmail (last 7 days)

Use `mcp__claude_ai_Gmail__search_threads`:

1. `newer_than:7d from:walmart.com subject:("thanks for your order" OR "order confirmation" OR "your order" OR shipped OR delivered)`
2. `newer_than:7d from:amazon.com subject:("your order" OR ordered OR "order confirmation" OR shipped)`
3. `newer_than:7d from:walmart.com subject:("item" OR "items" OR unavailable OR "out of stock" OR refund OR "changes to your order" OR "we couldn't" OR "could not be fulfilled")`

For promising threads use `mcp__claude_ai_Gmail__get_thread` and extract the **line items** (product names) plus order number and order date.

- **Confirmed purchases** (a buy happened) → the `purchases` array. Ignore shipping-status updates for orders you've already counted, marketing, and cart-reminder emails.
- **Unavailable / refunded items** (query 3): Walmart often sends a follow-up saying specific line items in an order were unavailable, out of stock, removed, or refunded. Extract just those affected product names plus the order number → the `unavailable` array. These are tied to a real order, so include the `orderId`; the server re-adds them to the list and won't keep a false "purchased" date for them. A whole-order cancellation counts every line as unavailable.

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
  ],
  "unavailable": [
    {
      "name": "blackberries",
      "orderId": "2000123-456789",
      "date": "2026-06-04",
      "matchedItemIds": ["blackberries-ab12c"]
    }
  ]
}
```

- `matchedItemIds` — the exact `id`s from grocery.json this entry covers (usually one); fall back to name matching when you can't find an id.
- `name` — the list item's name (helps the server fall back to name matching).
- `purchases` = confirmed buys (removed + restocked). `unavailable` = items an order couldn't fulfill (re-added to the list; the matching purchase is marked refunded and the staple is set back to Out). Include the `orderId` on unavailable entries so the server ties the refund to the right order.
- An item can appear in **both** (bought, then refunded) — that's fine; the server applies purchases first, then unavailability, so it nets back onto the list.
- Always write the file, even with empty arrays — the UI waits on this run to finish.
- Do **not** modify grocery.json, staples.json, or any other file — the server applies the changes.
